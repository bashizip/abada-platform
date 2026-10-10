package com.abada.engine.core.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.JobScheduler;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.dto.AgentStepDto;
import com.abada.engine.dto.AgentStepRequest;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LineageDto;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.project.ProjectConstants;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
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
 * E20b under the PostgreSQL authority: an agent delegates to a declared
 * process with checked inputs; its work parks while the child runs and
 * resumes with the child's declared outputs only; approval, child failure,
 * parent cancel, depth and engine restarts.
 */
@Testcontainers
class PostgresAgentDelegationTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PROJECT = ProjectConstants.DEFAULT_PROJECT_ID;
    private static final String PAYOUT = "{\"callId\":\"c1\",\"arguments\":{\"order\":\"A-7\",\"amount\":40}}";

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_delegation").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;

    @BeforeAll
    static void start() throws Exception {
        context = startApplication();
        deploy(Files.readString(Path.of("src/test/resources/apl/delegate-payout.apl.yaml")));
        deploy(Files.readString(Path.of("src/test/resources/apl/delegate-payout.apl.yaml"))
                .replace("key: refund_payout", "key: large_payout"));
        deploy(Files.readString(Path.of("src/test/resources/apl/agent-delegation.apl.yaml")));
        deploy("""
                version: abada.io/v1
                metadata: { key: approved_desk, name: Approved desk }
                flow:
                  entry: request
                  nodes:
                    - { id: request, type: webhook, next: triage }
                    - id: triage
                      type: agent
                      model: gemini-3.6-flash
                      prompt: Handle the large refund
                      delegates:
                        - { process: large_payout, outputs: [payout_id], approval: required, approvers: [finance] }
                      next: done
                    - { id: done, type: end }
                """);
        // An agent that already runs one level deep may not delegate further.
        deploy("""
                version: abada.io/v1
                metadata: { key: shallow_desk, name: Shallow desk }
                flow:
                  entry: request
                  nodes:
                    - { id: request, type: webhook, next: triage }
                    - id: triage
                      type: agent
                      model: gemini-3.6-flash
                      prompt: Handle it
                      delegates:
                        - { process: refund_payout, outputs: [payout_id], max_depth: 1 }
                      next: done
                    - { id: done, type: end }
                """);
        deploy("""
                version: abada.io/v1
                metadata: { key: outer_desk, name: Outer desk }
                flow:
                  entry: request
                  nodes:
                    - { id: request, type: webhook, next: call }
                    - { id: call, type: call-process, process: shallow_desk, outputs: { done_flag: triage_result }, next: done }
                    - { id: done, type: end }
                """);
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    void anAgentDelegatesAndResumesWithTheDeclaredOutputsOnly() {
        LockedExternalTask task = startAndLock("refund_desk");
        assertThat(task.agentWork().delegates()).singleElement().satisfies(delegate -> {
            assertThat(delegate.tool()).isEqualTo("delegate:refund_payout");
            assertThat(delegate.inputSchema()).containsEntry("additionalProperties", false);
            assertThat(delegate.approval()).isEqualTo("none");
        });
        modelTurn(task);
        // Undeclared targets and inputs the child does not accept change nothing.
        assertThatThrownBy(() -> record(task, step(2, "STARTED", "delegate:other_process", PAYOUT)))
                .isInstanceOfSatisfying(ApiException.class, error -> {
                    assertThat(error.status()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(error.details()).containsEntry("reason", "TOOL_NOT_BOUND");
                });
        assertRejected(task, step(2, "STARTED", "delegate:refund_payout",
                "{\"callId\":\"c1\",\"arguments\":{\"order\":7}}"), "DELEGATION_INPUT_INVALID");
        assertRejected(task, step(2, "STARTED", "delegate:refund_payout",
                "{\"callId\":\"c1\",\"arguments\":{\"coupon\":\"X\"}}"), "DELEGATION_INPUT_INVALID");
        assertThat(engine().lineage(task.processInstanceId()).children()).isEmpty();

        AgentStepDto started = record(task, step(2, "STARTED", "delegate:refund_payout", PAYOUT));
        assertThat(started.state()).isEqualTo("STARTED");
        assertThat(external(task.id()).getStatus()).isEqualTo(ExternalTaskEntity.Status.AWAITING_CHILD);
        assertThat(lockAll()).noneMatch(locked -> locked.id().equals(task.id()));
        // A lost response re-sent: the same step, no second child.
        record(task, step(2, "STARTED", "delegate:refund_payout", PAYOUT));
        List<LineageDto.Link> children = engine().lineage(task.processInstanceId()).children();
        assertThat(children).singleElement().satisfies(child -> {
            assertThat(child.parentActivityId()).isEqualTo("triage");
            assertThat(child.startedByAgent()).containsEntry("nodeId", "triage")
                    .containsEntry("model", "gemini-3.6-flash").containsEntry("step", 2);
        });
        String child = children.getFirst().instanceId();
        assertThat(engine().getProcessInstanceById(child).getVariables()).containsEntry("order", "A-7");

        completeChild(child, Map.of("payout_id", "P-1", "ledger_entry", "L-99"));
        runJobs();

        assertThat(external(task.id()).getStatus()).isEqualTo(ExternalTaskEntity.Status.OPEN);
        LockedExternalTask resumed = lock(task.processInstanceId());
        AgentStepDto delegation = resumed.steps().get(1);
        assertThat(delegation.state()).isEqualTo("COMPLETED");
        assertThat(delegation.result().path("outputs").path("payout_id").asText()).isEqualTo("P-1");
        assertThat(delegation.result().path("outputs").has("ledger_entry")).isFalse();
        assertThat(events(task.processInstanceId())).contains("DELEGATION_STARTED", "CHILD_STARTED",
                "DELEGATION_COMPLETED");
        // The parent token never moved; the agent finishes its work as usual.
        assertThat(engine().getProcessInstanceById(task.processInstanceId()).getActiveTokens())
                .containsExactly("triage");
        workers().complete(resumed.id(), "w", Map.of("triage_result", Map.of("payout", "P-1")));
        assertThat(engine().getProcessInstanceById(task.processInstanceId()).getStatus())
                .isEqualTo(ProcessStatus.COMPLETED);
    }

    @Test
    void aDelegationThatNeedsApprovalStartsTheChildOnlyAfterAPersonApproves() {
        LockedExternalTask task = startAndLock("approved_desk");
        modelTurn(task);
        assertRejected(task, step(2, "STARTED", "delegate:large_payout", PAYOUT), "APPROVAL_REQUIRED");
        record(task, step(2, "PROPOSED", "delegate:large_payout", PAYOUT));
        assertThat(external(task.id()).getStatus()).isEqualTo(ExternalTaskEntity.Status.AWAITING_APPROVAL);
        assertThat(engine().lineage(task.processInstanceId()).children()).isEmpty();

        String approval = context.getBean(TaskRepository.class).findAll().stream()
                .filter(row -> row.getProcessInstanceId().equals(task.processInstanceId()))
                .filter(row -> "TOOL_APPROVAL".equals(row.getKind())).findFirst().orElseThrow().getId();
        context.getBean(ToolApprovalService.class).decide(approval, "fiona", List.of("finance"), "approve", null,
                Map.of());

        LockedExternalTask approved = lock(task.processInstanceId());
        assertThat(approved.steps().get(1).state()).isEqualTo("APPROVED");
        record(approved, step(2, "STARTED", "delegate:large_payout", PAYOUT));
        String child = engine().lineage(task.processInstanceId()).children().getFirst().instanceId();
        completeChild(child, Map.of("payout_id", "P-2"));
        runJobs();
        assertThat(lock(task.processInstanceId()).steps().get(1).result().path("outputs").path("payout_id").asText())
                .isEqualTo("P-2");
    }

    @Test
    void aFailedChildIsReportedToTheAgentWhichContinues() {
        LockedExternalTask task = startAndLock("refund_desk");
        modelTurn(task);
        record(task, step(2, "STARTED", "delegate:refund_payout", PAYOUT));
        String child = engine().lineage(task.processInstanceId()).children().getFirst().instanceId();
        engine().cancelProcessInstance(child, "payout desk closed");
        runJobs();

        LockedExternalTask resumed = lock(task.processInstanceId());
        AgentStepDto delegation = resumed.steps().get(1);
        assertThat(delegation.state()).isEqualTo("FAILED");
        assertThat(delegation.result().path("status").asText()).isEqualTo("CANCELLED");
        assertThat(delegation.result().has("outputs")).isFalse();
        // The agent decides what to do with it: its next step is accepted.
        record(resumed, new AgentStepRequest("w", 1, 3, "MODEL_CALL", "COMPLETED", null, json("{\"turn\":2}"),
                json("{\"content\":\"escalate\"}"), null, "gemini-3.6-flash", "p1", 10, 5));
    }

    @Test
    void cancellingTheParentCancelsTheChildAndNothingResumes() {
        LockedExternalTask task = startAndLock("refund_desk");
        modelTurn(task);
        record(task, step(2, "STARTED", "delegate:refund_payout", PAYOUT));
        String child = engine().lineage(task.processInstanceId()).children().getFirst().instanceId();
        engine().cancelProcessInstance(task.processInstanceId(), "customer withdrew");
        assertThat(engine().getProcessInstanceById(child).getStatus()).isEqualTo(ProcessStatus.CANCELLED);
        assertThat(external(task.id()).getStatus()).isEqualTo(ExternalTaskEntity.Status.CANCELLED);
        assertThat(context.getBean(JdbcTemplate.class).queryForObject("select count(*) from jobs where"
                + " related_instance_id = ?", Integer.class, child)).isZero();
    }

    @Test
    void anAgentAlreadyNestedMayNotDelegateDeeperThanItsLimit() {
        String outer = engine().startProcess(PROJECT, "outer_desk", "alice", Map.of()).getId();
        String inner = engine().lineage(outer).children().getFirst().instanceId();
        LockedExternalTask task = lock(inner);
        modelTurn(task);
        assertRejected(task, step(2, "STARTED", "delegate:refund_payout", PAYOUT), "DELEGATION_DEPTH");
    }

    @Test
    void restartsWhileTheChildRunsAndBeforeTheResumeKeepOneChildAndOneResult() {
        LockedExternalTask task = startAndLock("refund_desk");
        modelTurn(task);
        record(task, step(2, "STARTED", "delegate:refund_payout", PAYOUT));
        String child = engine().lineage(task.processInstanceId()).children().getFirst().instanceId();

        context.close();                                         // restart while the child runs
        context = startApplication();
        completeChild(child, Map.of("payout_id", "P-3"));
        context.close();                                         // restart between the child's end and the resume
        context = startApplication();
        runJobs();
        runJobs();

        assertThat(engine().lineage(task.processInstanceId()).children()).hasSize(1);
        assertThat(events(task.processInstanceId()).stream().filter("DELEGATION_COMPLETED"::equals)).hasSize(1);
        LockedExternalTask resumed = lock(task.processInstanceId());
        assertThat(resumed.steps().get(1).result().path("outputs").path("payout_id").asText()).isEqualTo("P-3");
    }

    // ---------------------------------------------------------------- helpers

    private static AbadaEngine engine() {
        return context.getBean(AbadaEngine.class);
    }

    private static ExternalTaskCommandService workers() {
        return context.getBean(ExternalTaskCommandService.class);
    }

    private static void deploy(String source) {
        engine().deploy(PROJECT, new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)));
    }

    private static LockedExternalTask startAndLock(String key) {
        String instance = engine().startProcess(PROJECT, key, "alice", Map.of("order", "A-7")).getId();
        return lock(instance);
    }

    private static LockedExternalTask lock(String instanceId) {
        return lockAll().stream().filter(task -> task.processInstanceId().equals(instanceId)).findFirst()
                .orElseThrow(() -> new AssertionError("no agent task locked for " + instanceId));
    }

    private static List<LockedExternalTask> lockAll() {
        return workers().fetchAndLock(new FetchAndLockRequest("w", List.of("abada:agent"), 60_000L, 20));
    }

    private static void completeChild(String child, Map<String, Object> variables) {
        LockedExternalTask payout = workers().fetchAndLock(new FetchAndLockRequest("payer",
                List.of("payments.payout"), 60_000L, 20)).stream()
                .filter(locked -> locked.processInstanceId().equals(child)).findFirst().orElseThrow();
        workers().complete(payout.id(), "payer", new java.util.LinkedHashMap<>(variables));
    }

    private static void runJobs() {
        context.getBean(JobScheduler.class).executeDueJobs();
    }

    private static ExternalTaskEntity external(String id) {
        return context.getBean(ExternalTaskRepository.class).findById(id).orElseThrow();
    }

    private static List<String> events(String instanceId) {
        return context.getBean(JdbcTemplate.class).queryForList("select event_type from activity_history where"
                + " process_instance_id = ? order by occurred_at", String.class, instanceId);
    }

    private static void modelTurn(LockedExternalTask task) {
        record(task, new AgentStepRequest("w", task.attempt(), 1, "MODEL_CALL", "COMPLETED", null,
                json("{\"turn\":1}"), json("{\"toolCalls\":[\"delegate\"]}"), null, "gemini-3.6-flash", "p1", 10, 5));
    }

    private static AgentStepDto record(LockedExternalTask task, AgentStepRequest request) {
        return context.getBean(AgentStepService.class).record(task.id(), request);
    }

    private static void assertRejected(LockedExternalTask task, AgentStepRequest request, String reason) {
        assertThatThrownBy(() -> record(task, request)).isInstanceOfSatisfying(ApiException.class,
                error -> assertThat(error.details()).containsEntry("reason", reason));
    }

    private static AgentStepRequest step(int sequence, String state, String toolRef, String request) {
        return new AgentStepRequest("w", 1, sequence, "DELEGATION", state, toolRef, json(request), null, null, null,
                "p1", null, null);
    }

    private static JsonNode json(String value) {
        try {
            return JSON.readTree(value);
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
                        "abada.call-process.resume-immediately=false",
                        "abada.insight.llm.base-url=http://llm.test.invalid/v1",
                        "abada.insight.llm.api-key=test-key",
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
    }
}
