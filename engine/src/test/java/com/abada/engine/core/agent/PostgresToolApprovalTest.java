package com.abada.engine.core.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.dto.AgentStepDto;
import com.abada.engine.dto.AgentStepRequest;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.dto.ToolApprovalDto;
import com.abada.engine.persistence.entity.AgentStepEntity;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.AgentStepRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.ProjectResourceRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.project.ProjectConstants;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * E10 under the PostgreSQL authority: a proposed approval_required call parks
 * the agent's work and opens an approval for the right groups; the write runs
 * once, only after approval and only with the approved arguments; a rejection
 * reaches the agent; waiting survives a restart; boundaries and cancel retire
 * the approval.
 */
@Testcontainers
class PostgresToolApprovalTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PROJECT = ProjectConstants.DEFAULT_PROJECT_ID;
    private static final String PAYMENTS = """
            name: payments
            transport: streamable-http
            url: https://payments-mcp.internal/mcp
            tools:
              lookup: { policy: read }
              refund: { policy: approval_required, idempotency: key, approvers: [finance], approval_sla_hours: 4 }
              payout: { policy: approval_required, idempotency: none, approvers: [finance] }
            """;
    private static final String AGENT = """
            version: abada.io/v1
            metadata: { key: KEY, name: KEY }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: triage }
                - id: triage
                  type: agent
                  model: gemini-3.6-flash
                  prompt: Decide the refund
                  max_attempts: 3
                  tools: [payments/lookup, payments/refund, payments/payout]
                  on_timeout: { after: PT8H, then: late }
                  next: done
                - { id: late, type: end }
                - { id: done, type: end }
            """;
    private static final String REFUND = "{\"callId\":\"c1\",\"arguments\":{\"order\":\"A-7\",\"amount\":40}}";

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_approvals").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;
    /** A stand-in tool server: one effective write per idempotency key. */
    private static final Map<String, Integer> EFFECTIVE_WRITES = new ConcurrentHashMap<>();

    @BeforeAll
    static void start() {
        context = startApplication();
        ProjectResourceEntity server = new ProjectResourceEntity();
        server.setProjectId(PROJECT);
        server.setName("payments.yaml");
        server.setContentType("application/yaml");
        byte[] content = PAYMENTS.getBytes(StandardCharsets.UTF_8);
        server.setContent(content);
        server.setSizeBytes(content.length);
        server.setSha256(sha256(PAYMENTS));
        server.setKind(ProjectResourceEntity.Kind.TOOL_SERVER);
        server.setCreatedAt(Instant.now());
        server.setUpdatedAt(Instant.now());
        context.getBean(ProjectResourceRepository.class).save(server);
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    void aProposalParksTheWorkAndAnApprovalRunsTheWriteOnceWithTheApprovedArguments() {
        LockedExternalTask task = startAndLock("approve_case", "w1");
        modelTurn(task, 1);
        AgentStepDto proposed = record(task, step("w1", 1, 2, "PROPOSED", REFUND));
        assertThat(proposed.state()).isEqualTo("PROPOSED");
        assertThat(proposed.idempotencyKey()).isNull();

        // Parked: no lease, not acquirable, and a replay of the lost response answers the same step.
        ExternalTaskEntity parked = externalTask(task.id());
        assertThat(parked.getStatus()).isEqualTo(ExternalTaskEntity.Status.AWAITING_APPROVAL);
        assertThat(parked.getWorkerId()).isNull();
        assertThat(lockAll("w2")).noneMatch(locked -> locked.id().equals(task.id()));
        assertThat(record(task, step("w1", 1, 2, "PROPOSED", REFUND)).requestDigest())
                .isEqualTo(proposed.requestDigest());
        assertThatThrownBy(() -> record(task, step("w1", 1, 3, "COMPLETED", REFUND)))
                .isInstanceOf(ApiException.class);

        TaskEntity approval = approvalOf(task.processInstanceId());
        assertThat(approval.getStatus()).isEqualTo(TaskStatus.AVAILABLE);
        assertThat(approval.getCandidateGroups()).containsExactly("finance");
        assertThat(approval.getTaskDefinitionKey()).isEqualTo("triage");
        assertThat(approval.getDueAt()).isNotNull();
        assertThat(pendingJobs(task.processInstanceId())).contains("SLA");
        ToolApprovalDto view = view(approval);
        assertThat(view.toolRef()).isEqualTo("payments/refund");
        assertThat(view.argumentsDigest()).isEqualTo(proposed.requestDigest());
        assertThat(view.arguments().path("amount").asInt()).isEqualTo(40);
        assertThat(history(task.processInstanceId())).contains("TOOL_APPROVAL_REQUESTED");

        // Someone outside the group may not decide; neither does completing or failing it.
        assertThatThrownBy(() -> decide(approval.getId(), "mallory", List.of("support"), "approve", null))
                .isInstanceOf(ProcessEngineException.class);
        assertThatThrownBy(() -> context.getBean(AbadaEngine.class).completeTask(approval.getId(), "fiona",
                List.of("finance"), Map.of())).isInstanceOf(ProcessEngineException.class);
        assertThatThrownBy(() -> decide(approval.getId(), "fiona", List.of("finance"), "maybe", null))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> context.getBean(ToolApprovalService.class).decide(approval.getId(), "fiona",
                List.of("finance"), "approve", null, Map.of("amount", 4000)))
                .isInstanceOf(ApiException.class);

        decide(approval.getId(), "fiona", List.of("finance"), "approve", null);
        assertThat(taskRow(approval.getId()).getStatus()).isEqualTo(TaskStatus.COMPLETED);
        assertThat(externalTask(task.id()).getStatus()).isEqualTo(ExternalTaskEntity.Status.OPEN);
        assertThat(pendingJobs(task.processInstanceId())).doesNotContain("SLA").contains("BOUNDARY_TIMEOUT");
        AgentStepEntity decided = stepRow(task.id(), 2);
        assertThat(decided.getState()).isEqualTo(AgentStepEntity.State.APPROVED);
        assertThat(decided.getResolvedBy()).isEqualTo("fiona");
        assertThat(decided.getDecidedAt()).isNotNull();
        assertThat(history(task.processInstanceId())).contains("TOOL_APPROVAL_DECIDED");
        // The process did not move: the token is still at the agent.
        assertThat(engine().getProcessInstanceById(task.processInstanceId()).getActiveTokens())
                .containsExactly("triage");

        // The same attempt resumes with the approved step; changed arguments are refused.
        LockedExternalTask resumed = lock(task.processInstanceId(), "w2");
        assertThat(resumed.attempt()).isEqualTo(1);
        assertThat(resumed.steps()).extracting(AgentStepDto::state).containsExactly("COMPLETED", "APPROVED");
        assertRejected(resumed, step("w2", 1, 2, "STARTED",
                "{\"callId\":\"c1\",\"arguments\":{\"order\":\"A-7\",\"amount\":4000}}"), "DIVERGENT_STEP");
        assertRejected(resumed, step("w2", 1, 3, "STARTED", REFUND), "OPEN_STEP");
        AgentStepDto started = record(resumed, step("w2", 1, 2, "STARTED", REFUND));
        assertThat(started.idempotencyKey()).isEqualTo(sha256(task.id() + ":1:2"));
        callTool(started.idempotencyKey());
        callTool(started.idempotencyKey());                    // a re-send under the same key
        record(resumed, finished("w2", 1, 2, REFUND, "{\"refunded\":true}"));
        assertThat(EFFECTIVE_WRITES).containsEntry(started.idempotencyKey(), 1);
        context.getBean(ExternalTaskCommandService.class).complete(resumed.id(), "w2",
                Map.of("triage_result", Map.of("refunded", true)));
        assertThat(engine().getProcessInstanceById(task.processInstanceId()).getStatus())
                .isEqualTo(ProcessStatus.COMPLETED);
    }

    @Test
    void aRejectionReachesTheAgentAsTheToolResultAndNeedsAComment() {
        LockedExternalTask task = startAndLock("reject_case", "w1");
        modelTurn(task, 1);
        record(task, step("w1", 1, 2, "PROPOSED", REFUND));
        TaskEntity approval = approvalOf(task.processInstanceId());
        assertThatThrownBy(() -> decide(approval.getId(), "fiona", List.of("finance"), "reject", "  "))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.status()).isEqualTo(HttpStatus.BAD_REQUEST));

        decide(approval.getId(), "fiona", List.of("finance"), "reject", "Order A-7 was already refunded");
        LockedExternalTask resumed = lock(task.processInstanceId(), "w2");
        AgentStepDto rejected = resumed.steps().get(1);
        assertThat(rejected.state()).isEqualTo("REJECTED");
        assertThat(rejected.result().path("rejected").asBoolean()).isTrue();
        assertThat(rejected.result().path("comment").asText()).isEqualTo("Order A-7 was already refunded");
        // A rejected call never runs; the agent continues with its next step.
        assertRejected(resumed, step("w2", 1, 2, "STARTED", REFUND), "STEP_FINISHED");
        AgentStepDto next = record(resumed, new AgentStepRequest("w2", 1, 3, "MODEL_CALL", "COMPLETED", null,
                json("{\"turn\":2}"), json("{\"content\":\"no refund\"}"), null, "gemini-3.6-flash", "p1", 10, 5));
        assertThat(next.sequence()).isEqualTo(3);
        // Deciding again is refused: the task is done.
        assertThatThrownBy(() -> decide(approval.getId(), "fiona", List.of("finance"), "approve", null))
                .isInstanceOf(RuntimeException.class);
    }

    @Test
    void waitingSurvivesARestartAndTheSlaMarksTheApproval() {
        LockedExternalTask task = startAndLock("restart_case", "w1");
        modelTurn(task, 1);
        record(task, step("w1", 1, 2, "PROPOSED", REFUND));
        context.close();
        context = startApplication();

        TaskEntity approval = approvalOf(task.processInstanceId());
        assertThat(approval.getStatus()).isEqualTo(TaskStatus.AVAILABLE);
        assertThat(externalTask(task.id()).getStatus()).isEqualTo(ExternalTaskEntity.Status.AWAITING_APPROVAL);
        String token = approval.getTokenId();
        assertThat(engine().escalateTask(task.processInstanceId(), "triage", token)).isTrue();
        TaskEntity escalated = taskRow(approval.getId());
        assertThat(escalated.getEscalatedAt()).isNotNull();
        assertThat(escalated.getCandidateGroups()).containsExactly("finance");
        assertThat(history(task.processInstanceId())).contains("TASK_SLA_BREACHED");

        decide(approval.getId(), "fiona", List.of("finance"), "approve", null);
        LockedExternalTask resumed = lock(task.processInstanceId(), "w3");
        assertThat(resumed.steps()).extracting(AgentStepDto::state).containsExactly("COMPLETED", "APPROVED");
    }

    @Test
    void aTimeoutBoundaryOrACancelRetiresTheApproval() {
        LockedExternalTask timed = startAndLock("timeout_case", "w1");
        modelTurn(timed, 1);
        record(timed, step("w1", 1, 2, "PROPOSED", REFUND));
        String boundary = context.getBean(JdbcTemplate.class).queryForObject("select boundary_id from jobs where"
                + " process_instance_id = ? and job_kind = 'BOUNDARY_TIMEOUT' and status = 'AVAILABLE'", String.class,
                timed.processInstanceId());
        TaskEntity approval = approvalOf(timed.processInstanceId());
        assertThat(engine().fireTimeout(timed.processInstanceId(), "triage", approval.getTokenId(), boundary)).isTrue();
        assertThat(taskRow(approval.getId()).getStatus()).isEqualTo(TaskStatus.CANCELLED);
        assertThat(externalTask(timed.id()).getStatus()).isEqualTo(ExternalTaskEntity.Status.CANCELLED);
        assertThat(engine().getProcessInstanceById(timed.processInstanceId()).getStatus())
                .isEqualTo(ProcessStatus.COMPLETED);
        assertThatThrownBy(() -> decide(approval.getId(), "fiona", List.of("finance"), "approve", null))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.status()).isEqualTo(HttpStatus.GONE));

        LockedExternalTask cancelled = startAndLock("cancel_case", "w1");
        modelTurn(cancelled, 1);
        record(cancelled, step("w1", 1, 2, "PROPOSED", REFUND));
        TaskEntity second = approvalOf(cancelled.processInstanceId());
        engine().cancelProcessInstance(cancelled.processInstanceId(), "customer withdrew");
        assertThat(taskRow(second.getId()).getStatus()).isEqualTo(TaskStatus.CANCELLED);
        assertThat(externalTask(cancelled.id()).getStatus()).isEqualTo(ExternalTaskEntity.Status.CANCELLED);
        assertThat(pendingJobs(cancelled.processInstanceId())).isEmpty();
    }

    @Test
    void onlyAnApprovalRequiredCallIsProposedAndItIsNeverStartedUnapproved() {
        LockedExternalTask task = startAndLock("rules_case", "w1");
        assertRejected(task, step("w1", 1, 1, "STARTED", REFUND), "APPROVAL_REQUIRED");
        assertThatThrownBy(() -> record(task, new AgentStepRequest("w1", 1, 1, "TOOL_CALL", "PROPOSED",
                "payments/lookup", json("{}"), null, null, null, null, null, null)))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.status()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThatThrownBy(() -> record(task, step("w1", 1, 1, "APPROVED", REFUND)))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.status()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void anApprovedWriteWithAnUnknownOutcomeKeepsItsApproverAndIsNeverAskedOrSentAgain() {
        LockedExternalTask task = startAndLock("unknown_payout", "w1");
        modelTurn(task, 1);
        String payout = "{\"callId\":\"call-a\",\"arguments\":{\"order\":\"A-9\",\"amount\":12}}";
        record(task, payoutStep("w1", 1, 2, "PROPOSED", payout));
        decide(approvalOf(task.processInstanceId()).getId(), "fiona", List.of("finance"), "approve", null);
        LockedExternalTask approved = lock(task.processInstanceId(), "w2");
        record(approved, payoutStep("w2", 1, 2, "STARTED", payout));

        // The lease is lost before the result comes back: a write without a key is never handed out again.
        ExternalTaskEntity row = externalTask(task.id());
        row.setLockExpirationTime(Instant.now().minusSeconds(5));
        context.getBean(ExternalTaskRepository.class).save(row);
        assertThat(lockAll("w3")).noneMatch(locked -> locked.id().equals(task.id()));
        var incident = context.getBean(com.abada.engine.persistence.repository.IncidentRepository.class)
                .findByProcessInstanceIdAndResolvedAtIsNull(task.processInstanceId()).stream()
                .filter(open -> open.getType().equals("TOOL_OUTCOME_UNKNOWN")).findFirst().orElseThrow();
        com.abada.engine.security.IdentityContext.set(new com.abada.engine.security.Identity("olga", "olga",
                List.of("ops")));
        try {
            engine().retryIncident(task.processInstanceId(), incident.getId(), null, null, "PERFORMED");
        } finally {
            com.abada.engine.security.IdentityContext.clear();
        }

        // The approval evidence keeps its approver; the agent resumes with a readable confirmed result.
        assertThat(stepRow(task.id(), 2).getResolvedBy()).isEqualTo("fiona");
        LockedExternalTask resumed = lock(task.processInstanceId(), "w3");
        assertThat(resumed.attempt()).isEqualTo(1);
        AgentStepDto confirmed = resumed.steps().getLast();
        assertThat(confirmed.state()).isEqualTo("COMPLETED");
        assertThat(confirmed.result().path("content").asText()).startsWith("Performed");

        // A later attempt proposing the same payout, under the model's new call id, gets that result:
        // no second approval and nothing sent.
        context.getBean(ExternalTaskCommandService.class).handleFailure(resumed.id(),
                new com.abada.engine.dto.ExternalTaskFailureDto("w3", "invalid output", "", 2, 0L));
        LockedExternalTask next = lock(task.processInstanceId(), "w4");
        assertThat(next.attempt()).isEqualTo(2);
        modelTurn(next, 1);
        AgentStepDto again = record(next, payoutStep("w4", 2, 2, "PROPOSED",
                "{\"callId\":\"call-b\",\"arguments\":{\"amount\":12,\"order\":\"A-9\"}}"));
        assertThat(again.state()).isEqualTo("COMPLETED");
        assertThat(again.reused()).isTrue();
        assertThat(again.result().path("content").asText()).startsWith("Performed");
        assertThat(externalTask(task.id()).getStatus()).isEqualTo(ExternalTaskEntity.Status.LOCKED);
        assertThat(context.getBean(TaskRepository.class).findAll().stream()
                .filter(approval -> approval.getProcessInstanceId().equals(task.processInstanceId()))
                .filter(approval -> "TOOL_APPROVAL".equals(approval.getKind()))).hasSize(1);
    }

    // ---------------------------------------------------------------- helpers

    private static AbadaEngine engine() {
        return context.getBean(AbadaEngine.class);
    }

    private static void modelTurn(LockedExternalTask task, int sequence) {
        record(task, new AgentStepRequest(task.attempt() == null ? "w1" : workerOf(task), task.attempt(), sequence,
                "MODEL_CALL", "COMPLETED", null, json("{\"turn\":" + sequence + "}"),
                json("{\"toolCalls\":[\"payments/refund\"]}"), null, "gemini-3.6-flash", "p1", 10, 5));
    }

    private static String workerOf(LockedExternalTask task) {
        return externalTask(task.id()).getWorkerId();
    }

    private static void decide(String taskId, String user, List<String> groups, String outcome, String comment) {
        context.getBean(ToolApprovalService.class).decide(taskId, user, groups, outcome, comment, Map.of());
    }

    private static ToolApprovalDto view(TaskEntity approval) {
        var task = context.getBean(com.abada.engine.core.TaskManager.class).materialize(approval);
        ProcessInstance instance = engine().getProcessInstanceById(approval.getProcessInstanceId());
        return context.getBean(ToolApprovalService.class).view(task, instance);
    }

    private static TaskEntity approvalOf(String instanceId) {
        return context.getBean(TaskRepository.class).findAll().stream()
                .filter(task -> task.getProcessInstanceId().equals(instanceId))
                .filter(task -> "TOOL_APPROVAL".equals(task.getKind()))
                .reduce((first, second) -> second).orElseThrow(() -> new AssertionError("no approval task"));
    }

    private static TaskEntity taskRow(String taskId) {
        return context.getBean(TaskRepository.class).findById(taskId).orElseThrow();
    }

    private static ExternalTaskEntity externalTask(String id) {
        return context.getBean(ExternalTaskRepository.class).findById(id).orElseThrow();
    }

    private static AgentStepEntity stepRow(String externalTaskId, int sequence) {
        return context.getBean(AgentStepRepository.class)
                .findByExternalTaskIdAndAttemptAndSequence(externalTaskId, 1, sequence).orElseThrow();
    }

    private static List<String> pendingJobs(String instanceId) {
        return context.getBean(JdbcTemplate.class).queryForList("select job_kind from jobs where"
                + " process_instance_id = ? and status in ('AVAILABLE', 'LEASED')", String.class, instanceId);
    }

    private static List<String> history(String instanceId) {
        return context.getBean(JdbcTemplate.class).queryForList("select event_type from activity_history where"
                + " process_instance_id = ?", String.class, instanceId);
    }

    private static void callTool(String idempotencyKey) {
        EFFECTIVE_WRITES.putIfAbsent(idempotencyKey, 1);
    }

    private static LockedExternalTask startAndLock(String key, String workerId) {
        engine().deploy(PROJECT, new ByteArrayInputStream(AGENT.replace("KEY", key)
                .getBytes(StandardCharsets.UTF_8)));
        String instance = engine().startProcess(PROJECT, key, "alice", Map.of()).getId();
        return lock(instance, workerId);
    }

    private static LockedExternalTask lock(String instanceId, String workerId) {
        return lockAll(workerId).stream().filter(task -> task.processInstanceId().equals(instanceId))
                .findFirst().orElseThrow(() -> new AssertionError("no agent task locked for " + instanceId));
    }

    private static List<LockedExternalTask> lockAll(String workerId) {
        return context.getBean(ExternalTaskCommandService.class).fetchAndLock(
                new FetchAndLockRequest(workerId, List.of("abada:agent"), 60_000L, 20));
    }

    private static AgentStepDto record(LockedExternalTask task, AgentStepRequest request) {
        return context.getBean(AgentStepService.class).record(task.id(), request);
    }

    private static void assertRejected(LockedExternalTask task, AgentStepRequest request, String reason) {
        assertThatThrownBy(() -> record(task, request)).isInstanceOfSatisfying(ApiException.class,
                error -> assertThat(error.details()).containsEntry("reason", reason));
    }

    private static AgentStepRequest step(String workerId, int attempt, int sequence, String state, String request) {
        return new AgentStepRequest(workerId, attempt, sequence, "TOOL_CALL", state, "payments/refund",
                json(request), null, null, null, null, null, null);
    }

    private static AgentStepRequest payoutStep(String workerId, int attempt, int sequence, String state,
            String request) {
        return new AgentStepRequest(workerId, attempt, sequence, "TOOL_CALL", state, "payments/payout",
                json(request), null, null, null, null, null, null);
    }

    private static AgentStepRequest finished(String workerId, int attempt, int sequence, String request,
            String result) {
        return new AgentStepRequest(workerId, attempt, sequence, "TOOL_CALL", "COMPLETED", "payments/refund",
                json(request), json(result), null, null, null, null, null);
    }

    private static JsonNode json(String value) {
        try {
            return JSON.readTree(value);
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }

    private static ConfigurableApplicationContext startApplication() {
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(initialized -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(initialized,
                        "server.port=0",
                        "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=" + POSTGRES.getUsername(),
                        "spring.datasource.password=" + POSTGRES.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=6",
                        "spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect",
                        "spring.jpa.hibernate.ddl-auto=validate",
                        "spring.jpa.open-in-view=false",
                        "spring.flyway.enabled=true",
                        "spring.task.scheduling.enabled=false",
                        "abada.outbox.dispatcher.enabled=false",
                        "abada.security.mode=disabled",
                        "abada.insight.llm.base-url=http://llm.test.invalid/v1",
                        "abada.insight.llm.api-key=test-key",
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
    }
}
