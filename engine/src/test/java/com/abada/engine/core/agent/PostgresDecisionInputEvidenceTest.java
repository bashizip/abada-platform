package com.abada.engine.core.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.entity.DecisionInputEvidenceEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.DecisionInputEvidenceRepository;
import com.abada.engine.persistence.repository.ProjectRepository;
import com.abada.engine.security.AesEncryption;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The resolved inputs of each decision-table application are kept as evidence under the project's evidence
 * policy: encrypted, masked under {@code redacted}, absent under {@code none}, cleared after retention. History
 * carries the evidence id only, and a decision that cannot be made leaves no evidence behind.
 */
@Testcontainers
class PostgresDecisionInputEvidenceTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String IBAN = "BE68539007547034";
    private static final String SOURCE = """
            version: abada.io/v1
            metadata:
              key: payout_route
              name: Payout route
              variables:
                - { name: score, type: number }
                - { name: iban, type: string, sensitive: true }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: route }
                - id: route
                  type: decision-table
                  decisionKey: PAYOUT_ROUTE
                  hitPolicy: FIRST
                  inputs:
                    - name: score
                    - name: iban
                    - name: account
                      expr: "${iban}"
                  rules:
                    - when: score >= 700
                      then: { lane: "fast" }
                    - otherwise:
                        then: { lane: "manual" }
                  next: done
                - { id: done, type: end }
            """;
    private static final String NO_FALLBACK = """
            version: abada.io/v1
            metadata: { key: strict_route, name: Strict route }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: route }
                - id: route
                  type: decision-table
                  decisionKey: STRICT_ROUTE
                  inputs:
                    - name: score
                  rules:
                    - when: score >= 700
                      then: { lane: "fast" }
                  next: done
                - { id: done, type: end }
            """;

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_decision_inputs").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;
    private static MockMvc mvc;

    @BeforeAll
    static void start() {
        context = new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(initialized -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(initialized,
                        "server.port=0",
                        "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=" + POSTGRES.getUsername(),
                        "spring.datasource.password=" + POSTGRES.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=3",
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
        mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context)
                .defaultRequest(get("/").header("X-User", "alice")).build();
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    void theInputsFollowTheProjectsEvidencePolicyAndAreClearedAfterRetention() throws Exception {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        DecisionInputEvidenceRepository rows = context.getBean(DecisionInputEvidenceRepository.class);
        Map<String, Object> variables = Map.of("score", 720, "iban", IBAN);

        String redacted = project("redacted-decisions", "redacted", 30);
        String full = project("full-decisions", "full", 30);
        String none = project("none-decisions", "none", 30);
        for (String project : new String[] {redacted, full, none}) {
            engine.deploy(project, new ByteArrayInputStream(SOURCE.getBytes(StandardCharsets.UTF_8)));
        }
        String redactedId = engine.startProcess(redacted, "payout_route", "alice", variables).getId();
        String fullId = engine.startProcess(full, "payout_route", "alice", variables).getId();
        String noneId = engine.startProcess(none, "payout_route", "alice", variables).getId();

        // History names the inputs and points at the evidence, but never carries a value.
        DecisionInputEvidenceEntity redactedRow = evidenceOf(redactedId);
        ActivityHistoryEntity applied = applied(redactedId);
        assertThat(applied.getDetailsJson()).contains("\"evidenceId\":\"" + redactedRow.getId() + "\"")
                .contains("account").doesNotContain("720").doesNotContain(IBAN);
        assertThat(redactedRow.getActivityId()).isEqualTo("route");
        assertThat(redactedRow.getDecisionKey()).isEqualTo("PAYOUT_ROUTE");

        // Redacted: the sensitive variable is masked by name and wherever its value was read under another name.
        assertThat(redactedRow.isRedacted()).isTrue();
        JsonNode masked = decrypt(redactedRow);
        assertThat(masked.path("score").asInt()).isEqualTo(720);
        assertThat(masked.path("iban").asText()).isEqualTo(EvidenceRedactor.MASK);
        assertThat(masked.path("account").asText()).isEqualTo(EvidenceRedactor.MASK);
        // Full: as evaluated, and still encrypted at rest.
        DecisionInputEvidenceEntity fullRow = evidenceOf(fullId);
        assertThat(fullRow.isRedacted()).isFalse();
        assertThat(fullRow.getInputsEnc()).doesNotContain(IBAN).doesNotContain("720");
        assertThat(decrypt(fullRow).path("account").asText()).isEqualTo(IBAN);
        // None: a row says so, with nothing in it.
        DecisionInputEvidenceEntity noneRow = evidenceOf(noneId);
        assertThat(noneRow.getPayloadMode()).isEqualTo("none");
        assertThat(noneRow.getInputsEnc()).isNull();

        // Past retention the sweep clears the payload and keeps the row.
        EvidenceRetentionSweep sweep = context.getBean(EvidenceRetentionSweep.class);
        assertThat(sweep.sweep(Instant.now().plus(1, ChronoUnit.DAYS)).decisionInputsPurged()).isZero();
        assertThat(rows.findById(fullRow.getId()).orElseThrow().getInputsEnc()).isNotNull();
        assertThat(sweep.sweep(Instant.now().plus(31, ChronoUnit.DAYS)).decisionInputsPurged()).isEqualTo(2);
        DecisionInputEvidenceEntity purged = rows.findById(fullRow.getId()).orElseThrow();
        assertThat(purged.getInputsEnc()).isNull();
        assertThat(purged.getPurgedAt()).isNotNull();
        assertThat(sweep.sweep(Instant.now().plus(32, ChronoUnit.DAYS)).decisionInputsPurged()).isZero();
    }

    @Test
    void aDecisionThatCannotBeMadeLeavesNoEvidence() throws Exception {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String project = project("strict-decisions", "full", 30);
        engine.deploy(project, new ByteArrayInputStream(NO_FALLBACK.getBytes(StandardCharsets.UTF_8)));

        assertThatThrownBy(() -> engine.startProcess(project, "strict_route", "alice", Map.of("score", 100)))
                .hasMessageContaining("matched no rule");
        assertThat(context.getBean(DecisionInputEvidenceRepository.class).findAll())
                .noneMatch(row -> project.equals(row.getProjectId()));
    }

    private static DecisionInputEvidenceEntity evidenceOf(String instanceId) {
        return context.getBean(DecisionInputEvidenceRepository.class).findAll().stream()
                .filter(row -> row.getInstanceId().equals(instanceId)).findFirst().orElseThrow();
    }

    private static ActivityHistoryEntity applied(String instanceId) {
        return context.getBean(ActivityHistoryRepository.class).findByProcessInstanceIdOrderByOccurredAtAsc(instanceId)
                .stream().filter(event -> "DECISION_TABLE_APPLIED".equals(event.getEventType()))
                .findFirst().orElseThrow();
    }

    private static JsonNode decrypt(DecisionInputEvidenceEntity row) throws Exception {
        return JSON.readTree(context.getBean(AesEncryption.class).decrypt(row.getInputsEnc()));
    }

    private static String project(String slug, String payloads, int retentionDays) throws Exception {
        String id = JSON.readTree(mvc.perform(post("/v1/projects").contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("slug", slug, "name", slug, "description", ""))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("id").asText();
        var repository = context.getBean(ProjectRepository.class);
        var row = repository.findById(id).orElseThrow();
        row.setEvidencePayloads(payloads);
        row.setEvidenceRetentionDays(retentionDays);
        repository.save(row);
        return id;
    }
}
