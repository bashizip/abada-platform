package com.abada.engine.core.agent;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.model.AgentAttemptMetadata;
import com.abada.engine.dto.AgentStepRequest;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.InstanceCostDto;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.llm.ModelPriceService;
import com.abada.engine.persistence.entity.AgentStepEntity;
import com.abada.engine.persistence.entity.ProjectEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.AgentStepRepository;
import com.abada.engine.persistence.repository.ProjectRepository;
import com.abada.engine.project.ProjectConstants;
import com.abada.engine.security.AesEncryption;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
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
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * E11 under the PostgreSQL authority: what the journal keeps under each
 * evidence policy, what each call and instance costs, and how retention and
 * finished tasks clear payloads.
 */
@Testcontainers
class PostgresEvidenceAndCostTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PROJECT = ProjectConstants.DEFAULT_PROJECT_ID;
    private static final String IBAN = "DE89370400440532013000";
    private static final String TOKEN = "abcdefghijklmnop1234";
    private static final String MODEL = "gemini-3.6-flash";
    private static final String AGENT = """
            version: abada.io/v1
            metadata:
              key: KEY
              name: KEY
              variables:
                - { name: iban, type: string, sensitive: true }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: triage }
                - id: triage
                  type: agent
                  model: gemini-3.6-flash
                  prompt: Triage the refund
                  EVIDENCE
                  next: done
                - { id: done, type: end }
            """;

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_evidence").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;

    @BeforeAll
    static void start() {
        context = startApplication();
        context.getBean(ModelPriceService.class).add(MODEL, null, new BigDecimal("1.0"), new BigDecimal("2.0"),
                Instant.now().minusSeconds(3600));
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    void redactedEvidenceNeverHoldsSecretsOrSensitiveValuesAndKeepsTheSameDigest() throws Exception {
        setProjectPolicy("redacted", 30);
        LockedExternalTask task = startAndLock("redacted_case", "");
        String result = "{\"text\":\"Customer " + IBAN + " sent Authorization: Bearer " + TOKEN + "\",\"iban\":\""
                + IBAN + "\",\"verdict\":\"refund\"}";
        record(task, 1, MODEL, "{\"messages\":1}", result, 1000, 500);

        AgentStepEntity row = onlyStep(task);
        assertThat(row.getPayloadMode()).isEqualTo("redacted");
        AesEncryption encryption = context.getBean(AesEncryption.class);
        String evidence = encryption.decrypt(row.getEvidenceResultEnc());
        assertThat(evidence).doesNotContain(IBAN, TOKEN).contains("refund");
        // The working copy, for a resumed lease, is complete; both columns are ciphertext.
        assertThat(encryption.decrypt(row.getResultEnc())).contains(IBAN);
        assertThat(row.getResultEnc() + row.getEvidenceResultEnc()).doesNotContain(IBAN, TOKEN);
        assertThat(row.getResultDigest()).isEqualTo(AgentStepService.digest(JSON.readTree(result)));
        assertThat(row.getPurgeAfter()).isAfter(Instant.now().plusSeconds(29L * 24 * 3600));
    }

    @Test
    void aNodeCanOnlyTightenTheProjectPolicy() {
        setProjectPolicy("full", 30);
        LockedExternalTask none = startAndLock("none_case", "evidence: { payloads: none, retention_days: 3 }");
        record(none, 1, MODEL, "{\"messages\":1}", "{\"text\":\"ok\"}", 10, 10);
        AgentStepEntity row = onlyStep(none);
        assertThat(row.getPayloadMode()).isEqualTo("none");
        assertThat(row.getEvidenceRequestEnc()).isNull();
        assertThat(row.getEvidenceResultEnc()).isNull();
        assertThat(row.getPurgeAfter()).isBefore(Instant.now().plusSeconds(4L * 24 * 3600));

        setProjectPolicy("redacted", 30);
        LockedExternalTask looser = startAndLock("looser_case", "evidence: { payloads: full }");
        record(looser, 1, MODEL, "{\"messages\":1}", "{\"text\":\"ok\"}", 10, 10);
        assertThat(onlyStep(looser).getPayloadMode()).isEqualTo("redacted");
    }

    @Test
    void theEngineComputesCostFromTokensAndPricesAndNeverCountsAnAttemptTwice() {
        setProjectPolicy("redacted", 30);
        LockedExternalTask journaled = startAndLock("cost_case", "");
        record(journaled, 1, MODEL, "{}", "{}", 1000, 500);
        record(journaled, 2, "unknown-model", "{}", "{}", 10, 10);
        List<AgentStepEntity> steps = context.getBean(AgentStepRepository.class)
                .findByExternalTaskIdOrderByAttemptAscSequenceAsc(journaled.id());
        assertThat(steps.get(0).getCostUsd()).isEqualByComparingTo("0.002");
        assertThat(steps.get(1).getCostUsd()).isNull();
        assertThat(steps.get(1).isCostUnpriced()).isTrue();
        // The worker also reports the attempt's tokens: priced from the steps, not again.
        complete(journaled, 1000, 500);

        LockedExternalTask reported = startAndLock("reported_case", "");
        complete(reported, 2000, 1000);

        Map<String, InstanceCostDto> costs = context.getBean(AgentCostService.class)
                .costs(List.of(journaled.processInstanceId(), reported.processInstanceId()));
        InstanceCostDto first = costs.get(journaled.processInstanceId());
        assertThat(first.usd()).isEqualByComparingTo("0.002");
        assertThat(first.promptTokens()).isEqualTo(1010);
        assertThat(first.includesUnpriced()).isTrue();
        InstanceCostDto second = costs.get(reported.processInstanceId());
        assertThat(second.usd()).isEqualByComparingTo("0.004");
        assertThat(second.promptTokens()).isEqualTo(2000);
        assertThat(second.completionTokens()).isEqualTo(1000);
        assertThat(second.includesUnpriced()).isFalse();

        assertThat(context.getBean(MeterRegistry.class).find("abada.agent.cost.usd").tag("model", MODEL)
                .counters()).isNotEmpty();
    }

    @Test
    void retentionPurgesPayloadsOnceAcrossConcurrentSweepsAndKeepsDigests() throws Exception {
        setProjectPolicy("full", 30);
        LockedExternalTask task = startAndLock("retention_case", "");
        for (int sequence = 1; sequence <= 6; sequence++) {
            record(task, sequence, MODEL, "{\"n\":" + sequence + "}", "{\"ok\":true}", 1, 1);
        }
        AgentStepRepository steps = context.getBean(AgentStepRepository.class);
        List<AgentStepEntity> rows = steps.findByExternalTaskIdOrderByAttemptAscSequenceAsc(task.id());
        rows.forEach(row -> row.setPurgeAfter(Instant.now().minusSeconds(1)));
        steps.saveAll(rows);

        EvidenceRetentionSweep sweep = context.getBean(EvidenceRetentionSweep.class);
        CountDownLatch go = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        List<Future<EvidenceRetentionSweep.Result>> runs = List.of(
                pool.submit(() -> { go.await(); return sweep.sweep(Instant.now()); }),
                pool.submit(() -> { go.await(); return sweep.sweep(Instant.now()); }));
        go.countDown();
        int purged = 0;
        for (Future<EvidenceRetentionSweep.Result> run : runs) purged += run.get().purged();
        pool.shutdown();
        assertThat(purged).isEqualTo(6);

        context.close();                                      // Restarted, nothing is purged twice.
        context = startApplication();
        assertThat(context.getBean(EvidenceRetentionSweep.class).sweep(Instant.now()).purged()).isZero();
        assertThat(context.getBean(AgentStepRepository.class).findByExternalTaskIdOrderByAttemptAscSequenceAsc(task.id()))
                .allSatisfy(row -> {
                    assertThat(row.getPurgedAt()).isNotNull();
                    assertThat(row.getRequestEnc()).isNull();
                    assertThat(row.getEvidenceResultEnc()).isNull();
                    assertThat(row.getRequestDigest()).isNotBlank();
                    assertThat(row.getCostUsd()).isNotNull();
                });
        int recorded = context.getBean(ActivityHistoryRepository.class)
                .findByProcessInstanceIdOrderByOccurredAtAsc(task.processInstanceId()).stream()
                .filter(event -> event.getEventType().equals("EVIDENCE_PURGED"))
                .mapToInt(event -> json(event.getDetailsJson()).path("steps").asInt()).sum();
        assertThat(recorded).isEqualTo(6);
    }

    @Test
    void theWorkingCopyIsClearedOnceTheTaskIsCompletedAndTheEvidenceStays() {
        setProjectPolicy("redacted", 30);
        LockedExternalTask task = startAndLock("finished_case", "");
        record(task, 1, MODEL, "{\"m\":1}", "{\"verdict\":\"refund\"}", 5, 5);
        complete(task, null, null);

        context.getBean(EvidenceRetentionSweep.class).sweep(Instant.now());
        AgentStepEntity row = onlyStep(task);
        assertThat(row.getRequestEnc()).isNull();
        assertThat(row.getResultEnc()).isNull();
        assertThat(row.getEvidenceResultEnc()).isNotNull();
        assertThat(row.getPurgedAt()).isNull();
    }

    private static JsonNode json(String value) {
        try {
            return JSON.readTree(value);
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }

    private static void setProjectPolicy(String payloads, int days) {
        ProjectRepository projects = context.getBean(ProjectRepository.class);
        ProjectEntity project = projects.findById(PROJECT).orElseThrow();
        project.setEvidencePayloads(payloads);
        project.setEvidenceRetentionDays(days);
        projects.save(project);
    }

    private static LockedExternalTask startAndLock(String key, String evidence) {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        engine.deploy(PROJECT, new ByteArrayInputStream(AGENT.replace("KEY", key).replace("EVIDENCE", evidence)
                .getBytes(StandardCharsets.UTF_8)));
        String instance = engine.startProcess(PROJECT, key, "alice", Map.of("iban", IBAN)).getId();
        return context.getBean(ExternalTaskCommandService.class)
                .fetchAndLock(new FetchAndLockRequest("w", List.of("abada:agent"), 60_000L, 20)).stream()
                .filter(task -> task.processInstanceId().equals(instance)).findFirst().orElseThrow();
    }

    private static void record(LockedExternalTask task, int sequence, String model, String request, String result,
            Integer prompt, Integer completion) {
        try {
            context.getBean(AgentStepService.class).record(task.id(), new AgentStepRequest("w", 1, sequence,
                    "MODEL_CALL", "COMPLETED", null, JSON.readTree(request), JSON.readTree(result), null, model,
                    "p1", prompt, completion));
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }

    private static void complete(LockedExternalTask task, Integer prompt, Integer completion) {
        context.getBean(ExternalTaskCommandService.class).complete(task.id(), "w", Map.of("triage_result", "ok"),
                new AgentAttemptMetadata(MODEL, "gemini", 1, 10L, List.of(), "triage_result", "h", null, null,
                        prompt, completion));
    }

    private static AgentStepEntity onlyStep(LockedExternalTask task) {
        List<AgentStepEntity> rows = context.getBean(AgentStepRepository.class)
                .findByExternalTaskIdOrderByAttemptAscSequenceAsc(task.id());
        assertThat(rows).hasSize(1);
        return rows.getFirst();
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
