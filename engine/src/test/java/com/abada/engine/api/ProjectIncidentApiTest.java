package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.TaskManager;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.IncidentDTO;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

/** Project members see the loop incidents of their project; others do not learn they exist. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class ProjectIncidentApiTest {
    @Autowired private TestRestTemplate rest;
    @Autowired private AbadaEngine engine;
    @Autowired private ExternalTaskCommandService workers;
    @Autowired private TaskManager tasks;
    @Autowired private DatabaseTestHelper database;
    @Autowired private com.abada.engine.core.EventManager events;

    private String projectId;
    private String instanceId;

    @BeforeEach
    void exhaustALoop() {
        database.cleanup();
        engine.clearMemory();
        ResponseEntity<Map<String, Object>> created = rest.exchange("/v1/projects", HttpMethod.POST,
                new HttpEntity<>(Map.of("slug", "loop-incidents", "name", "Loop incidents", "description", ""),
                        headers("alice")), new ParameterizedTypeReference<>() {});
        projectId = (String) created.getBody().get("id");
        engine.deploy(projectId, new ByteArrayInputStream("""
                version: abada.io/v1
                metadata: { key: once_only, name: Once only }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: draft }
                    - { id: draft, type: engine-task, service: once-draft, loop: { max_iterations: 1 }, next: review }
                    - { id: review, type: human-input, assignees: [reviewers], next: decide }
                    - id: decide
                      type: condition
                      rules:
                        - if: "${approved == true}"
                          then: done
                        - else: draft
                    - { id: done, type: end }
                """.getBytes(StandardCharsets.UTF_8)));
        instanceId = engine.startProcess(projectId, "once_only", "alice", Map.of()).getId();
        var draft = workers.fetchAndLock(new FetchAndLockRequest("w", List.of("once-draft"), 60_000L));
        workers.complete(draft.getFirst().id(), "w", Map.of());
        var review = tasks.getTasksForProcessInstance(instanceId).getFirst();
        engine.completeTask(review.getId(), "bob", List.of("reviewers"), Map.of("approved", false));
    }

    @Test
    void membersListOpenIncidentsAndCancellingResolvesThem() {
        assertThat(incidents("alice", true).getBody()).singleElement().satisfies(incident -> {
            assertThat(incident.processInstanceId()).isEqualTo(instanceId);
            assertThat(incident.type()).isEqualTo("LOOP_EXHAUSTED");
            assertThat(incident.projectId()).isEqualTo(projectId);
        });

        engine.cancelProcessInstance(instanceId, "stop");

        assertThat(incidents("alice", true).getBody()).isEmpty();
        assertThat(incidents("alice", false).getBody()).singleElement()
                .satisfies(incident -> assertThat(incident.resolution()).isEqualTo("INSTANCE_CANCELLED"));
    }

    @Test
    void anOperatorRetryStartsAFreshPassAndResolvesTheIncident() {
        IncidentDTO open = incidents("alice", true).getBody().getFirst();

        ResponseEntity<Void> retried = rest.exchange("/v1/projects/{projectId}/incidents/{incidentId}/retry",
                HttpMethod.POST, new HttpEntity<>(headers("alice")), Void.class, projectId, open.id());

        assertThat(retried.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(incidents("alice", true).getBody()).isEmpty();
        assertThat(incidents("alice", false).getBody()).singleElement()
                .satisfies(incident -> assertThat(incident.resolution()).isEqualTo("RETRIED"));
        // The draft step runs again: a fresh pass with new work for the drafter.
        assertThat(engine.getProcessInstanceById(instanceId).getVariables()).containsEntry("draft_iteration", 1);
        assertThat(workers.fetchAndLock(new FetchAndLockRequest("w", List.of("once-draft"), 60_000L))).hasSize(1);
    }

    @Test
    void viewersCannotRetry() {
        IncidentDTO open = incidents("alice", true).getBody().getFirst();

        ResponseEntity<String> denied = rest.exchange("/v1/projects/{projectId}/incidents/{incidentId}/retry",
                HttpMethod.POST, new HttpEntity<>(headers("mallory")), String.class, projectId, open.id());

        assertThat(denied.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(incidents("alice", true).getBody()).hasSize(1);
    }

    @Test
    void aMessageWaitWithoutKeyOpensAnIncidentThatRetryFixesOnceTheKeyIsSet() {
        engine.deploy(projectId, new ByteArrayInputStream("""
                version: abada.io/v1
                metadata: { key: paid_wait, name: Paid wait }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: paid }
                    - { id: paid, type: message-catch, message: Paid, next: done }
                    - { id: done, type: end }
                """.getBytes(StandardCharsets.UTF_8)));
        String waiting = engine.startProcess(projectId, "paid_wait", "alice", Map.of()).getId();
        IncidentDTO missing = incidents("alice", true).getBody().stream()
                .filter(incident -> incident.processInstanceId().equals(waiting)).findFirst().orElseThrow();
        assertThat(missing.type()).isEqualTo("MISSING_CORRELATION_KEY");

        engine.updateProcessVariables(waiting, Map.of("correlationKey", "order-9"));
        rest.exchange("/v1/projects/{projectId}/incidents/{incidentId}/retry", HttpMethod.POST,
                new HttpEntity<>(headers("alice")), Void.class, projectId, missing.id());
        events.correlateMessage("Paid", "order-9", Map.of());

        assertThat(engine.getProcessInstanceById(waiting).isCompleted()).isTrue();
    }

    @Test
    void nonMembersCannotSeeThem() {
        ResponseEntity<String> denied = rest.exchange("/v1/projects/{projectId}/incidents", HttpMethod.GET,
                new HttpEntity<>(headers("mallory")), String.class, projectId);
        assertThat(denied.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(denied.getBody()).doesNotContain(instanceId);
    }

    private ResponseEntity<List<IncidentDTO>> incidents(String user, boolean open) {
        return rest.exchange("/v1/projects/{projectId}/incidents?open={open}", HttpMethod.GET,
                new HttpEntity<>(headers(user)), new ParameterizedTypeReference<>() {}, projectId, open);
    }

    private static HttpHeaders headers(String user) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-User", user);
        headers.set("X-Groups", "customers");
        return headers;
    }
}
