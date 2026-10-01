package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.OutboxEventRepository;
import com.abada.engine.persistence.repository.ProcessDefinitionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** GET /v1/apl/schema and POST /v1/apl/validate under the PostgreSQL authority. */
@Testcontainers
@ExtendWith(OutputCaptureExtension.class)
class AplContractControllerTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SECRET_MARKER = "do-not-log-this-prompt-7f3a";

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_apl_contract").withUsername("abada").withPassword("abada");

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
                        "abada.agent.allowed-models=house-model,second-model",
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
        mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    void schemaStatesThisEnginesModelsAndSupportsConditionalRequests() throws Exception {
        var response = mvc.perform(get("/v1/apl/schema"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/schema+json"))
                .andExpect(jsonPath("$.$id").value("https://abada.io/schemas/apl/v1.json"))
                .andExpect(jsonPath("$.$defs.agentModel.enum[0]").value("house-model"))
                .andExpect(jsonPath("$.$defs.agentModel.enum[1]").value("second-model"))
                .andExpect(jsonPath("$.x-abada-runtime.schemaViolations").value("WARNING"))
                .andReturn().getResponse();
        String etag = response.getHeader("ETag");
        assertThat(etag).isNotBlank();
        mvc.perform(get("/v1/apl/schema").header("If-None-Match", etag)).andExpect(status().isNotModified());
    }

    @Test
    void validateReportsEveryErrorWithItsLocationAndPersistsNothing(CapturedOutput output) throws Exception {
        long definitions = context.getBean(ProcessDefinitionRepository.class).count();
        long history = context.getBean(ActivityHistoryRepository.class).count();
        long outbox = context.getBean(OutboxEventRepository.class).count();

        mvc.perform(validate("""
                        version: abada.io/v1
                        metadata: { key: broken, name: Broken }
                        flow:
                          entry: start
                          nodes:
                            - { id: start, type: webhook, next: score }
                            - id: score
                              type: agent
                              model: unknown-model
                              prompt: "%s"
                              next: missing
                            - { id: done, type: end }
                        """.formatted(SECRET_MARKER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.processKey").doesNotExist())
                .andExpect(jsonPath("$.issues[0].severity").value("ERROR"))
                .andExpect(jsonPath("$.issues[0].elementId").value("score"))
                .andExpect(jsonPath("$.issues[0].path").value("/flow/nodes/1/model"))
                .andExpect(jsonPath("$.issues[1].path").value("/flow/nodes/1/next"));

        assertThat(context.getBean(ProcessDefinitionRepository.class).count()).isEqualTo(definitions);
        assertThat(context.getBean(ActivityHistoryRepository.class).count()).isEqualTo(history);
        assertThat(context.getBean(OutboxEventRepository.class).count()).isEqualTo(outbox);
        assertThat(output.getAll()).doesNotContain(SECRET_MARKER);
    }

    @Test
    void warningsDoNotMakeADocumentInvalid() throws Exception {
        mvc.perform(validate(WARNED))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(true))
                .andExpect(jsonPath("$.processKey").value("warned"))
                .andExpect(jsonPath("$.issues[0].code").value("ABADA-APL-SCHEMA-001"))
                .andExpect(jsonPath("$.issues[0].severity").value("WARNING"))
                .andExpect(jsonPath("$.issues[0].path").value("/flow/nodes/1/retries"));
    }

    @Test
    void deploymentAcceptsWarningsAndReportsThem() throws Exception {
        mvc.perform(multipart("/v1/processes/deploy")
                        .file(new MockMultipartFile("file", "warned.apl.yaml", "application/yaml", WARNED.getBytes())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.compatibilityReport.issues[0].code").value("ABADA-APL-SCHEMA-001"))
                .andExpect(jsonPath("$.compatibilityReport.issues[0].path").value("/flow/nodes/1/retries"));
    }

    @Test
    void oversizedSourceIsAnErrorNotACrash() throws Exception {
        String huge = "version: abada.io/v1\n#" + "x".repeat(10 * 1024 * 1024);
        mvc.perform(validate(huge))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.issues[0].message").value("APL deployment exceeds the 10 MiB input limit"));
    }

    @Test
    void missingSourceIsAnInvalidRequest() throws Exception {
        mvc.perform(post("/v1/apl/validate").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    private static final String WARNED = """
            version: abada.io/v1
            metadata: { key: warned, name: Warned }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: work }
                - { id: work, type: engine-task, service: crm-sync, retries: 3, next: done }
                - { id: done, type: end }
            """;

    private static org.springframework.test.web.servlet.RequestBuilder validate(String source) throws Exception {
        return post("/v1/apl/validate").contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(Map.of("source", source)));
    }
}
