package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.TaskManager;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
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
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

/** The decision endpoint: typed, validated by the engine, idempotent and scoped to project members. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class TaskDecisionApiTest {
    @Autowired private TestRestTemplate rest;
    @Autowired private AbadaEngine engine;
    @Autowired private TaskManager tasks;
    @Autowired private DatabaseTestHelper database;
    @Autowired private ActivityHistoryRepository history;

    private static final String REVIEW = """
            version: abada.io/v1
            metadata: { key: KEY, name: Review }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: review }
                - id: review
                  type: human-input
                  assignees: [reviewers]
                  outcomes:
                    approve: { next: done }
                    reject: { next: rejected, comment: required }
                - { id: rejected, type: end }
                - { id: done, type: end }
            """;

    private String projectId;
    private String instanceId;
    private String taskId;

    @BeforeEach
    void startAReview() {
        database.cleanup();
        engine.clearMemory();
        ResponseEntity<Map<String, Object>> created = rest.exchange("/v1/projects", HttpMethod.POST,
                new HttpEntity<>(Map.of("slug", "reviews", "name", "Reviews", "description", ""), headers("alice")),
                new ParameterizedTypeReference<>() {});
        projectId = (String) created.getBody().get("id");
        engine.deploy(projectId, new ByteArrayInputStream(REVIEW.replace("KEY", "review_api")
                .getBytes(StandardCharsets.UTF_8)));
        instanceId = engine.startProcess(projectId, "review_api", "alice", Map.of()).getId();
        taskId = tasks.getTasksForProcessInstance(instanceId).getFirst().getId();
    }

    @Test
    void theTaskListsItsOutcomesAndAValidRejectionIsRecordedOnceForARepeatedKey() {
        ResponseEntity<Map<String, Object>> detail = rest.exchange("/v1/projects/{p}/tasks/{t}", HttpMethod.GET,
                new HttpEntity<>(headers("alice")), new ParameterizedTypeReference<>() {}, projectId, taskId);
        assertThat(detail.getBody().get("outcomes")).isEqualTo(List.of(
                Map.of("name", "approve", "commentRequired", false),
                Map.of("name", "reject", "commentRequired", true)));

        HttpHeaders keyed = json("alice");
        keyed.set("Idempotency-Key", "decision-1");
        Map<String, Object> body = Map.of("outcome", "reject", "comment", "Wrong customer");
        for (int attempt = 0; attempt < 2; attempt++) {
            ResponseEntity<Map<String, Object>> decided = rest.exchange("/v1/projects/{p}/tasks/{t}/decision",
                    HttpMethod.POST, new HttpEntity<>(body, keyed), new ParameterizedTypeReference<>() {},
                    projectId, taskId);
            assertThat(decided.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(decided.getBody()).containsEntry("status", "Decided");
        }
        assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isTrue();
        assertThat(history.findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                .filteredOn(entry -> entry.getEventType().equals("TASK_COMPLETED")).hasSize(1);
    }

    @Test
    void invalidDecisionsArePlainCompletionsAndStrangersAreRejected() {
        ResponseEntity<String> noComment = rest.exchange("/v1/projects/{p}/tasks/{t}/decision", HttpMethod.POST,
                new HttpEntity<>(Map.of("outcome", "reject"), json("alice")), String.class, projectId, taskId);
        assertThat(noComment.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(noComment.getBody()).contains("requires a comment");

        ResponseEntity<String> plain = rest.exchange("/v1/projects/{p}/tasks/{t}/complete", HttpMethod.POST,
                new HttpEntity<>(Map.of("approved", true), json("alice")), String.class, projectId, taskId);
        assertThat(plain.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(plain.getBody()).contains("needs a decision");

        ResponseEntity<String> stranger = rest.exchange("/v1/projects/{p}/tasks/{t}/decision", HttpMethod.POST,
                new HttpEntity<>(Map.of("outcome", "approve"), json("mallory")), String.class, projectId, taskId);
        assertThat(stranger.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

        assertThat(engine.getProcessInstanceById(instanceId).getActiveTokens()).containsExactly("review");
    }

    @Test
    void theDefaultProjectEndpointDecidesToo() {
        engine.deploy(new ByteArrayInputStream(REVIEW.replace("KEY", "review_default")
                .getBytes(StandardCharsets.UTF_8)));
        String id = engine.startProcess("review_default", "alice", Map.of()).getId();
        String task = tasks.getTasksForProcessInstance(id).getFirst().getId();

        ResponseEntity<String> decided = rest.exchange("/v1/tasks/{t}/decision", HttpMethod.POST,
                new HttpEntity<>(Map.of("outcome", "approve"), json("alice")), String.class, task);

        assertThat(decided.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(engine.getProcessInstanceById(id).getVariables()).containsEntry("review_outcome", "approve");
    }

    private static HttpHeaders json(String user) {
        HttpHeaders headers = headers(user);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders headers(String user) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-User", user);
        headers.set("X-Groups", "reviewers");
        return headers;
    }
}
