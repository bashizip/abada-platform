package com.abada.engine.core.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.dto.AgentStepDto;
import com.abada.engine.dto.AgentStepRequest;
import com.abada.engine.dto.ExternalTaskFailureDto;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.AgentStepEntity;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.IncidentEntity;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.persistence.repository.AgentStepRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.IncidentRepository;
import com.abada.engine.persistence.repository.ProjectResourceRepository;
import com.abada.engine.project.ProjectConstants;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * E9 under the PostgreSQL authority: the journal's rules, resume after a lost
 * lease and an engine restart without resending a write, unknown write
 * outcomes going to a person, and writes reused across attempts.
 */
@Testcontainers
class PostgresAgentStepJournalTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PROJECT = ProjectConstants.DEFAULT_PROJECT_ID;
    private static final String MARKER = "customer-iban-DE89-3704";
    private static final String CRM = """
            name: crm
            transport: streamable-http
            url: https://crm-mcp.internal/mcp
            tools:
              get_customer:  { policy: read }
              create_ticket: { policy: write, idempotency: key }
              notify:        { policy: write, idempotency: none }
              refund:        { policy: approval_required, idempotency: key, approvers: [finance] }
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
                  prompt: Triage the request
                  max_attempts: 3
                  tools: [crm/get_customer, crm/create_ticket, crm/notify, crm/refund]
                  next: done
                - { id: done, type: end }
            """;

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_steps").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;

    /** A stand-in tool server: one effective write per idempotency key, or per call without one. */
    private static final Map<String, Integer> EFFECTIVE_WRITES = new ConcurrentHashMap<>();

    @BeforeAll
    static void start() throws Exception {
        context = startApplication();
        ProjectResourceEntity server = new ProjectResourceEntity();
        server.setProjectId(PROJECT);
        server.setName("crm.yaml");
        server.setContentType("application/yaml");
        byte[] content = CRM.getBytes(StandardCharsets.UTF_8);
        server.setContent(content);
        server.setSizeBytes(content.length);
        server.setSha256(sha256(CRM));
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
    void theJournalAcceptsOnlyTheNextStepFromTheLeaseHolderAndIsIdempotent() {
        LockedExternalTask task = startAndLock("rules", "w1");
        assertThat(task.attempt()).isEqualTo(1);
        assertThat(task.steps()).isEmpty();

        AgentStepDto model = record(task, step("w1", 1, 1, "MODEL_CALL", "COMPLETED", null,
                "{\"turn\":1}", "{\"toolCalls\":[\"crm/get_customer\"]}"));
        assertThat(model.state()).isEqualTo("COMPLETED");
        assertThat(model.requestDigest()).isEqualTo(AgentStepService.digest(json("{\"turn\":1}")));
        // An identical replay answers the same step; a different result for it is refused.
        assertThat(record(task, step("w1", 1, 1, "MODEL_CALL", "COMPLETED", null, "{\"turn\":1}",
                "{\"toolCalls\":[\"crm/get_customer\"]}")).resultDigest()).isEqualTo(model.resultDigest());
        assertRejected(task, step("w1", 1, 1, "MODEL_CALL", "COMPLETED", null, "{\"turn\":1}", "{\"other\":1}"),
                HttpStatus.CONFLICT, "DIVERGENT_STEP");
        assertRejected(task, step("w1", 1, 3, "MODEL_CALL", "COMPLETED", null, "{}", "{}"),
                HttpStatus.CONFLICT, "SEQUENCE");
        assertRejected(task, step("w1", 2, 2, "MODEL_CALL", "COMPLETED", null, "{}", "{}"),
                HttpStatus.CONFLICT, "STALE_ATTEMPT");
        assertThatThrownBy(() -> record(task, step("intruder", 1, 2, "MODEL_CALL", "COMPLETED", null, "{}", "{}")))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.status()).isEqualTo(HttpStatus.FORBIDDEN));

        record(task, step("w1", 1, 2, "TOOL_CALL", "STARTED", "crm/get_customer", "{\"id\":7}", null));
        assertRejected(task, step("w1", 1, 3, "MODEL_CALL", "COMPLETED", null, "{}", "{}"),
                HttpStatus.CONFLICT, "OPEN_STEP");
        AgentStepDto read = record(task, step("w1", 1, 2, "TOOL_CALL", "COMPLETED", "crm/get_customer",
                "{\"id\":7}", "{\"name\":\"Ada\"}"));
        assertThat(read.policy()).isEqualTo("read");
        assertThat(read.idempotencyKey()).isNull();
    }

    @Test
    void theEngineDecidesWhichToolCallsMayHappen() {
        LockedExternalTask task = startAndLock("policy", "w1");
        assertThatThrownBy(() -> record(task, step("w1", 1, 1, "TOOL_CALL", "STARTED", "erp/get_order", "{}", null)))
                .isInstanceOfSatisfying(ApiException.class, error -> {
                    assertThat(error.status()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(error.details()).containsEntry("reason", "TOOL_NOT_BOUND");
                });
        assertRejected(task, step("w1", 1, 1, "TOOL_CALL", "STARTED", "crm/refund", "{\"amount\":10}", null),
                HttpStatus.CONFLICT, "APPROVAL_REQUIRED");
        assertRejected(task, step("w1", 1, 1, "TOOL_CALL", "COMPLETED", "crm/create_ticket", "{}", "{}"),
                HttpStatus.CONFLICT, "WRITE_AHEAD_REQUIRED");

        AgentStepDto write = record(task, step("w1", 1, 1, "TOOL_CALL", "STARTED", "crm/create_ticket",
                "{\"subject\":\"refund\"}", null));
        assertThat(write.idempotencyKey()).isEqualTo(sha256(task.id() + ":1:1"));
        record(task, step("w1", 1, 1, "TOOL_CALL", "COMPLETED", "crm/create_ticket", "{\"subject\":\"refund\"}",
                "{\"ticket\":\"T-1\"}"));
        AgentStepDto unkeyed = record(task, step("w1", 1, 2, "TOOL_CALL", "STARTED", "crm/notify", "{}", null));
        assertThat(unkeyed.idempotencyKey()).isNull();
    }

    @Test
    void aResumedWriteKeepsItsKeyAcrossALostLeaseAndAnEngineRestartSoItTakesEffectOnce() {
        LockedExternalTask first = startAndLock("resume", "w1");
        String subject = "{\"subject\":\"" + MARKER + "\"}";
        AgentStepDto started = record(first, step("w1", 1, 1, "TOOL_CALL", "STARTED", "crm/create_ticket", subject,
                null));
        callTool(started.idempotencyKey());                   // the call reaches the server...
        expireLease(first.id());                              // ...and the worker dies before journaling it.

        context.close();                                      // The engine restarts too.
        context = startApplication();

        LockedExternalTask resumed = lock(first.processInstanceId(), "w2");
        assertThat(resumed.attempt()).isEqualTo(1);
        assertThat(resumed.steps()).singleElement().satisfies(step -> {
            assertThat(step.state()).isEqualTo("STARTED");
            assertThat(step.idempotencyKey()).isEqualTo(started.idempotencyKey());
            assertThat(step.request()).isEqualTo(json(subject));
        });
        // The new holder re-sends the same write with the same key; the server applies it once.
        record(resumed, step("w2", 1, 1, "TOOL_CALL", "STARTED", "crm/create_ticket", subject, null));
        callTool(started.idempotencyKey());
        record(resumed, step("w2", 1, 1, "TOOL_CALL", "COMPLETED", "crm/create_ticket", subject,
                "{\"ticket\":\"T-9\"}"));
        assertThat(EFFECTIVE_WRITES.get(started.idempotencyKey())).isEqualTo(1);

        // Payloads are encrypted at rest; digests stay readable.
        AgentStepEntity row = context.getBean(AgentStepRepository.class)
                .findByExternalTaskIdOrderByAttemptAscSequenceAsc(first.id()).getFirst();
        assertThat(row.getRequestEnc()).doesNotContain(MARKER);
        assertThat(row.getRequestDigest()).isEqualTo(AgentStepService.digest(json(subject)));
    }

    @Test
    void anInterruptedWriteWithoutAKeyIsNeverResentAndAPersonConfirmsItsOutcome() {
        LockedExternalTask task = startAndLock("unknown", "w1");
        record(task, step("w1", 1, 1, "TOOL_CALL", "STARTED", "crm/notify", "{\"to\":\"ops\"}", null));
        expireLease(task.id());

        assertThat(lockAll("w2")).noneMatch(locked -> locked.id().equals(task.id()));
        AgentStepEntity unknown = context.getBean(AgentStepRepository.class)
                .findByExternalTaskIdOrderByAttemptAscSequenceAsc(task.id()).getFirst();
        assertThat(unknown.getState()).isEqualTo(AgentStepEntity.State.OUTCOME_UNKNOWN);
        IncidentEntity incident = context.getBean(IncidentRepository.class)
                .findByProcessInstanceIdAndResolvedAtIsNull(task.processInstanceId()).stream()
                .filter(open -> open.getType().equals("TOOL_OUTCOME_UNKNOWN")).findFirst().orElseThrow();

        ExternalTaskCommandService workers = context.getBean(ExternalTaskCommandService.class);
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        assertThatThrownBy(() -> workers.setRetries(task.id(), 3)).isInstanceOf(ProcessEngineException.class)
                .hasMessageContaining("unknown outcome");
        assertThatThrownBy(() -> engine.retryIncident(task.processInstanceId(), incident.getId(), null, null, null))
                .isInstanceOf(ProcessEngineException.class).hasMessageContaining("PERFORMED");

        engine.retryIncident(task.processInstanceId(), incident.getId(), null, null, "NOT_PERFORMED");
        LockedExternalTask resumed = lock(task.processInstanceId(), "w2");
        assertThat(resumed.attempt()).isEqualTo(1);
        assertThat(resumed.steps()).singleElement().satisfies(step -> {
            assertThat(step.state()).isEqualTo("FAILED");
            assertThat(step.errorType()).isEqualTo("NOT_PERFORMED_CONFIRMED");
        });
        // The agent decides again with that fact, as the next step.
        record(resumed, step("w2", 1, 2, "MODEL_CALL", "COMPLETED", null, "{\"turn\":2}", "{\"final\":true}"));
    }

    @Test
    void anotherAttemptReusesAnIdenticalCompletedWriteInsteadOfResendingIt() {
        LockedExternalTask first = startAndLock("attempts", "w1");
        String ticket = "{\"subject\":\"duplicate charge\"}";
        record(first, step("w1", 1, 1, "TOOL_CALL", "STARTED", "crm/create_ticket", ticket, null));
        record(first, step("w1", 1, 1, "TOOL_CALL", "COMPLETED", "crm/create_ticket", ticket, "{\"ticket\":\"T-3\"}"));
        context.getBean(ExternalTaskCommandService.class).handleFailure(first.id(),
                new ExternalTaskFailureDto("w1", "invalid output", "", 2, 0L));

        LockedExternalTask second = lock(first.processInstanceId(), "w1");
        assertThat(second.attempt()).isEqualTo(2);
        assertThat(second.steps()).isEmpty();
        assertThat(second.priorWrites()).singleElement()
                .satisfies(write -> assertThat(write.result()).isEqualTo(json("{\"ticket\":\"T-3\"}")));

        AgentStepDto again = record(second, step("w1", 2, 1, "TOOL_CALL", "STARTED", "crm/create_ticket", ticket,
                null));
        assertThat(again.reused()).isTrue();
        assertThat(again.state()).isEqualTo("COMPLETED");
        assertThat(again.result()).isEqualTo(json("{\"ticket\":\"T-3\"}"));
    }

    @Test
    void aFailureNeverStartsANewAttemptOverAWriteStillStarted() {
        LockedExternalTask task = startAndLock("open_write", "w1");
        AgentStepDto started = record(task, step("w1", 1, 1, "TOOL_CALL", "STARTED", "crm/create_ticket",
                "{\"subject\":\"x\"}", null));
        context.getBean(ExternalTaskCommandService.class).handleFailure(task.id(),
                new ExternalTaskFailureDto("w1", "tool server down", "", 2, 0L));

        LockedExternalTask resumed = lock(task.processInstanceId(), "w2");
        assertThat(resumed.attempt()).isEqualTo(1);
        assertThat(resumed.steps()).singleElement().satisfies(step -> {
            assertThat(step.state()).isEqualTo("STARTED");
            assertThat(step.idempotencyKey()).isEqualTo(started.idempotencyKey());
        });
    }

    @Test
    void retiredWorkRefusesSteps() {
        LockedExternalTask task = startAndLock("retired", "w1");
        context.getBean(ExternalTaskCommandService.class).complete(task.id(), "w1", Map.of("triage_result", "ok"));
        assertThatThrownBy(() -> record(task, step("w1", 1, 1, "MODEL_CALL", "COMPLETED", null, "{}", "{}")))
                .isInstanceOfSatisfying(ApiException.class, error -> {
                    assertThat(error.status()).isEqualTo(HttpStatus.GONE);
                    assertThat(error.code()).isEqualTo(ApiErrorCode.WORK_RETIRED);
                });
    }

    @Test
    void concurrentPostsOfTheSameStepJournalOneRow() throws Exception {
        LockedExternalTask task = startAndLock("concurrent", "w1");
        AgentStepRequest same = step("w1", 1, 1, "MODEL_CALL", "COMPLETED", null, "{\"turn\":1}", "{\"ok\":true}");
        CountDownLatch go = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(4);
        List<Future<AgentStepDto>> results = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            Callable<AgentStepDto> call = () -> {
                go.await();
                return record(task, same);
            };
            results.add(pool.submit(call));
        }
        go.countDown();
        Set<String> digests = ConcurrentHashMap.newKeySet();
        for (Future<AgentStepDto> result : results) digests.add(result.get().resultDigest());
        pool.shutdown();
        assertThat(digests).hasSize(1);
        assertThat(context.getBean(AgentStepRepository.class)
                .findByExternalTaskIdOrderByAttemptAscSequenceAsc(task.id())).hasSize(1);
    }

    private static void callTool(String idempotencyKey) {
        EFFECTIVE_WRITES.putIfAbsent(idempotencyKey, 1);
    }

    private static LockedExternalTask startAndLock(String key, String workerId) {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        engine.deploy(PROJECT, new ByteArrayInputStream(AGENT.replace("KEY", key).getBytes(StandardCharsets.UTF_8)));
        String instance = engine.startProcess(PROJECT, key, "alice", Map.of()).getId();
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

    private static void expireLease(String externalTaskId) {
        ExternalTaskRepository repository = context.getBean(ExternalTaskRepository.class);
        ExternalTaskEntity task = repository.findById(externalTaskId).orElseThrow();
        task.setLockExpirationTime(Instant.now().minusSeconds(5));
        repository.save(task);
    }

    private static AgentStepDto record(LockedExternalTask task, AgentStepRequest request) {
        return context.getBean(AgentStepService.class).record(task.id(), request);
    }

    private static void assertRejected(LockedExternalTask task, AgentStepRequest request, HttpStatus status,
            String reason) {
        assertThatThrownBy(() -> record(task, request)).isInstanceOfSatisfying(ApiException.class, error -> {
            assertThat(error.status()).isEqualTo(status);
            assertThat(error.details()).containsEntry("reason", reason);
        });
    }

    private static AgentStepRequest step(String workerId, int attempt, int sequence, String kind, String state,
            String toolRef, String request, String result) {
        return new AgentStepRequest(workerId, attempt, sequence, kind, state, toolRef, json(request),
                result == null ? null : json(result), null, "gemini-3.6-flash", "p1", 10, 5);
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
