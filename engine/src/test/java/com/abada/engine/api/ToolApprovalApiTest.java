package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.agent.AgentStepService;
import com.abada.engine.dto.AgentStepRequest;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.ProjectResourceRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.project.ProjectConstants;
import com.abada.engine.util.DatabaseTestHelper;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

/**
 * Who may decide a tool approval and what they see: only the approver
 * groups, never a worker credential; the proposed call is shown under the
 * evidence policy with the digest the decision binds to, and no process
 * variables.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = AbadaEngineApplication.class,
        properties = {"abada.insight.llm.base-url=http://llm.test.invalid/v1", "abada.insight.llm.api-key=test-key"})
@ActiveProfiles("test")
class ToolApprovalApiTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PROJECT = ProjectConstants.DEFAULT_PROJECT_ID;
    private static final String PAYMENTS = """
            name: payments
            transport: streamable-http
            url: https://payments-mcp.internal/mcp
            tools:
              refund: { policy: approval_required, idempotency: key, approvers: [finance] }
            """;

    @Autowired private TestRestTemplate rest;
    @Autowired private AbadaEngine engine;
    @Autowired private ExternalTaskCommandService workers;
    @Autowired private AgentStepService steps;
    @Autowired private TaskRepository tasks;
    @Autowired private ExternalTaskRepository externalTasks;
    @Autowired private ProjectResourceRepository resources;
    @Autowired private DatabaseTestHelper database;

    private String taskId;
    private String externalTaskId;

    @BeforeEach
    void proposeARefund() throws Exception {
        database.cleanup();
        engine.clearMemory();
        resources.findAll().stream().filter(resource -> resource.getKind() == ProjectResourceEntity.Kind.TOOL_SERVER)
                .forEach(resources::delete);
        ProjectResourceEntity server = new ProjectResourceEntity();
        server.setProjectId(PROJECT);
        server.setName("payments.yaml");
        server.setContentType("application/yaml");
        byte[] content = PAYMENTS.getBytes(StandardCharsets.UTF_8);
        server.setContent(content);
        server.setSizeBytes(content.length);
        server.setSha256("0".repeat(64));
        server.setKind(ProjectResourceEntity.Kind.TOOL_SERVER);
        server.setCreatedAt(Instant.now());
        server.setUpdatedAt(Instant.now());
        resources.save(server);
        engine.deploy(PROJECT, new ByteArrayInputStream("""
                version: abada.io/v1
                metadata: { key: refund_case, name: Refund case }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: triage }
                    - { id: triage, type: agent, model: gemini-3.6-flash, prompt: Refund, tools: [payments/refund], next: done }
                    - { id: done, type: end }
                """.getBytes(StandardCharsets.UTF_8)));
        engine.startProcess(PROJECT, "refund_case", "alice", Map.of("iban", "DE89-3704"));
        LockedExternalTask task = workers.fetchAndLock(new FetchAndLockRequest("w", List.of("abada:agent"), 60_000L))
                .getFirst();
        externalTaskId = task.id();
        steps.record(task.id(), new AgentStepRequest("w", 1, 1, "TOOL_CALL", "PROPOSED", "payments/refund",
                JSON.readTree("{\"callId\":\"c1\",\"arguments\":{\"order\":\"A-7\",\"amount\":40}}"), null, null,
                null, null, null, null));
        taskId = tasks.findAll().stream().filter(row -> "TOOL_APPROVAL".equals(row.getKind())).findFirst()
                .orElseThrow().getId();
    }

    @Test
    void approversSeeTheProposedCallAndNoProcessVariables() {
        ResponseEntity<Map> detail = rest.exchange("/v1/tasks/" + taskId, HttpMethod.GET,
                new HttpEntity<>(headers("fiona", "finance")), Map.class);
        assertThat(detail.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(detail.getBody()).containsEntry("kind", "TOOL_APPROVAL");
        assertThat((Map<?, ?>) detail.getBody().get("variables")).isEmpty();
        Map<?, ?> approval = (Map<?, ?>) detail.getBody().get("toolApproval");
        assertThat(approval.get("toolRef")).isEqualTo("payments/refund");
        assertThat(approval.get("argumentsDigest")).asString().hasSize(64);
        assertThat(((Map<?, ?>) approval.get("arguments")).get("amount")).isEqualTo(40);
        assertThat((List<?>) detail.getBody().get("outcomes")).hasSize(2);

        ResponseEntity<String> mine = rest.exchange("/v1/tasks", HttpMethod.GET,
                new HttpEntity<>(headers("fiona", "finance")), String.class);
        assertThat(mine.getBody()).contains(taskId);
        ResponseEntity<String> theirs = rest.exchange("/v1/tasks", HttpMethod.GET,
                new HttpEntity<>(headers("mallory", "support")), String.class);
        assertThat(theirs.getBody()).doesNotContain(taskId);
    }

    @Test
    void onlyAnApproverDecidesAndNeverAWorkerCredential() {
        assertThat(decide("mallory", "support", "approve", null).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        // A worker credential may not decide even if it also sits in the approver group.
        ResponseEntity<String> worker = decide("svc-worker", "abada-worker,finance", "approve", null);
        assertThat(worker.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(worker.getBody()).contains("worker credential");
        assertThat(decide("fiona", "finance", "reject", null).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        // Completing it like an ordinary task is refused.
        HttpHeaders json = headers("fiona", "finance");
        json.setContentType(MediaType.APPLICATION_JSON);
        assertThat(rest.exchange("/v1/tasks/complete?taskId=" + taskId, HttpMethod.POST,
                new HttpEntity<>(Map.of(), json), String.class).getStatusCode().is4xxClientError()).isTrue();
        assertThat(externalTasks.findById(externalTaskId).orElseThrow().getStatus())
                .isEqualTo(ExternalTaskEntity.Status.AWAITING_APPROVAL);

        assertThat(decide("fiona", "finance", "approve", null).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(externalTasks.findById(externalTaskId).orElseThrow().getStatus())
                .isEqualTo(ExternalTaskEntity.Status.OPEN);
    }

    private ResponseEntity<String> decide(String user, String groups, String outcome, String comment) {
        HttpHeaders headers = headers(user, groups);
        headers.setContentType(MediaType.APPLICATION_JSON);
        Map<String, Object> body = comment == null ? Map.of("outcome", outcome)
                : Map.of("outcome", outcome, "comment", comment);
        return rest.exchange("/v1/tasks/" + taskId + "/decision", HttpMethod.POST, new HttpEntity<>(body, headers),
                String.class);
    }

    private static HttpHeaders headers(String user, String groups) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-User", user);
        headers.set("X-Groups", groups);
        return headers;
    }
}
