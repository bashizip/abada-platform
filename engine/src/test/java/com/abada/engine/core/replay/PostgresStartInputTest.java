package com.abada.engine.core.replay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.agent.EvidenceRetentionSweep;
import com.abada.engine.persistence.repository.ProcessStartInputRepository;
import com.abada.engine.persistence.repository.ProjectRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
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
 * E15: the variables a root instance started with are kept under the project's evidence policy, encrypted,
 * and cleared after retention. Child instances record nothing: replaying the parent replays them.
 */
@Testcontainers
class PostgresStartInputTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SOURCE = """
            version: abada.io/v1
            metadata:
              key: intake
              name: Intake
              variables:
                - { name: case_id, type: string }
                - { name: iban, type: string, sensitive: true }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: wait }
                - id: wait
                  type: human-input
                  assignees: [reviewers]
                  next: done
                - { id: done, type: end }
            """;

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_start_inputs").withUsername("abada").withPassword("abada");

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
    void theStartInputsFollowTheProjectsEvidencePolicyAndAreClearedAfterRetention() throws Exception {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        StartInputService inputs = context.getBean(StartInputService.class);
        ProcessStartInputRepository rows = context.getBean(ProcessStartInputRepository.class);
        Map<String, Object> variables = Map.of("case_id", "C-1", "iban", "BE68539007547034", "password", "hunter2hunter2");

        String redacted = project("redacted-inputs", "redacted", 30);
        String full = project("full-inputs", "full", 30);
        String none = project("none-inputs", "none", 30);
        for (String project : new String[] {redacted, full, none}) {
            engine.deploy(project, new ByteArrayInputStream(SOURCE.getBytes(StandardCharsets.UTF_8)));
        }
        String redactedId = engine.startProcess(redacted, "intake", "alice", variables).getId();
        String fullId = engine.startProcess(full, "intake", "alice", variables).getId();
        String noneId = engine.startProcess(none, "intake", "alice", variables).getId();

        // Redacted: sensitive variables and secret-like fields are masked, and the loss is flagged.
        var kept = inputs.find(redactedId).orElseThrow();
        assertThat(kept.redacted()).isTrue();
        assertThat(kept.variables()).containsEntry("case_id", "C-1").containsEntry("iban", "****")
                .containsEntry("password", "****");
        // Full: as sent.
        assertThat(inputs.find(fullId).orElseThrow().variables()).isEqualTo(variables);
        assertThat(inputs.find(fullId).orElseThrow().redacted()).isFalse();
        // None: a row says so, but there is nothing to replay.
        assertThat(rows.findById(noneId).orElseThrow().getPayloadMode()).isEqualTo("none");
        assertThat(inputs.find(noneId)).isEmpty();

        // The payload is encrypted at rest.
        assertThat(rows.findById(fullId).orElseThrow().getInputsEnc()).doesNotContain("C-1")
                .doesNotContain("BE68539007547034");

        // Past retention the sweep clears the payload and keeps the row.
        EvidenceRetentionSweep.Result early = context.getBean(EvidenceRetentionSweep.class)
                .sweep(Instant.now().plus(1, ChronoUnit.DAYS));
        assertThat(early.startInputsPurged()).isZero();
        assertThat(inputs.find(fullId)).isPresent();
        EvidenceRetentionSweep.Result late = context.getBean(EvidenceRetentionSweep.class)
                .sweep(Instant.now().plus(31, ChronoUnit.DAYS));
        assertThat(late.startInputsPurged()).isEqualTo(2);
        assertThat(inputs.find(fullId)).isEmpty();
        assertThat(rows.findById(fullId).orElseThrow().getPurgedAt()).isNotNull();
    }

    @Test
    void aChildInstanceRecordsNoStartInputs() throws Exception {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String project = project("children", "full", 30);
        for (String fixture : new String[] {"/apl/call-fraud-check.apl.yaml", "/apl/call-refund.apl.yaml"}) {
            try (InputStream stream = PostgresStartInputTest.class.getResourceAsStream(fixture)) {
                engine.deploy(project, stream);
            }
        }
        String parent = engine.startProcess(project, "refund_with_check", "alice",
                Map.of("case_id", "C-9", "amount", 40)).getId();
        assertThat(context.getBean(ProcessStartInputRepository.class).findAll().stream()
                .filter(row -> row.getProjectId().equals(project)))
                .singleElement().satisfies(row -> assertThat(row.getInstanceId()).isEqualTo(parent));
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
