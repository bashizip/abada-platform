package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.ProjectResourceRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
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
 * E16 under the PostgreSQL authority: a rollback deploys an earlier version's source as the next version,
 * running instances stay on what they started on, and a rollback that cannot be honoured writes nothing.
 */
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PostgresRollbackTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static String PROJECT;
    private static final String CRM = """
            name: crm
            transport: streamable-http
            url: https://crm-mcp.internal/mcp
            tools:
              get_customer:  { policy: read }
              other:         { policy: read }
            """;

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_rollback").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;
    private static MockMvc mvc;

    @BeforeAll
    static void start() throws Exception {
        context = new SpringApplicationBuilder(AbadaEngineApplication.class)
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
        PROJECT = JSON.readTree(mvc.perform(post("/v1/projects").contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("slug", "rollback", "name", "Rollback",
                                "description", ""))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("id").asText();
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    @Order(1)
    void aRollbackDeploysTheOldSourceAsTheNextVersionAndLeavesRunningInstancesAlone() throws Exception {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        deploy(plain("loan", "first wording"));
        var second = deploy(plain("loan", "second wording"));
        String running = engine.startProcess(PROJECT, "loan", "alice", Map.of()).getId();

        JsonNode rolled = JSON.readTree(mvc.perform(post("/v1/projects/{p}/processes/loan/versions/1/rollback", PROJECT)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("comment", "  Wording regressed approvals  ",
                                "expectedLatest", 2))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(rolled.path("version").asInt()).isEqualTo(3);
        assertThat(rolled.path("bpmnXml").asText()).contains("first wording").doesNotContain("second wording");

        // The instance started before the rollback finishes on the version it started on.
        assertThat(engine.getProcessInstanceById(running).getProcessDefinitionDeploymentId())
                .isEqualTo(second.getDeploymentId());
        String after = engine.startProcess(PROJECT, "loan", "alice", Map.of()).getId();
        assertThat(engine.getProcessInstanceById(after).getProcessDefinitionDeploymentId())
                .isEqualTo(rolled.path("deploymentId").asText());

        mvc.perform(get("/v1/projects/{p}/processes/loan/versions", PROJECT))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].version").value(3))
                .andExpect(jsonPath("$[0].origin").value("ROLLBACK"))
                .andExpect(jsonPath("$[0].rollbackOf").value(1))
                .andExpect(jsonPath("$[0].comment").value("Wording regressed approvals"))
                .andExpect(jsonPath("$[0].current").value(true))
                .andExpect(jsonPath("$[0].runningInstances").value(1))
                .andExpect(jsonPath("$[1].version").value(2))
                .andExpect(jsonPath("$[1].origin").value("DEPLOY"))
                .andExpect(jsonPath("$[1].runningInstances").value(1))
                .andExpect(jsonPath("$[2].version").value(1));

        List<ActivityHistoryEntity> rollbacks = context.getBean(ActivityHistoryRepository.class).findAll().stream()
                .filter(entry -> entry.getEventType().equals("DEFINITION_ROLLED_BACK")).toList();
        assertThat(rollbacks).singleElement().satisfies(entry -> {
            assertThat(entry.getActor()).isEqualTo("alice");
            assertThat(entry.getDetailsJson()).contains("\"fromVersion\":2").contains("\"restoredVersion\":1")
                    .contains("\"newVersion\":3").doesNotContain("Wording regressed");
        });

        // A rollback of a rollback is just another deployment.
        mvc.perform(post("/v1/projects/{p}/processes/loan/versions/2/rollback", PROJECT)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("comment", "Back again"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(4));
    }

    @Test
    @Order(2)
    void aRollbackThatCannotBeHonouredChangesNothing() throws Exception {
        deploy(plain("quote", "one"));
        deploy(plain("quote", "two"));
        String url = "/v1/projects/{p}/processes/quote/versions/{v}/rollback";
        mvc.perform(post(url, PROJECT, 1).contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("comment", "  "))))
                .andExpect(status().isBadRequest());
        mvc.perform(post(url, PROJECT, 2).contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("comment", "Already current"))))
                .andExpect(status().isConflict());
        mvc.perform(post(url, PROJECT, 1).contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("comment", "Stale", "expectedLatest", 1))))
                .andExpect(status().isConflict());
        mvc.perform(post(url, PROJECT, 9).contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("comment", "No such version"))))
                .andExpect(status().isNotFound());
        mvc.perform(get("/v1/projects/{p}/processes/quote/versions", PROJECT))
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    @Order(3)
    void aDependencyThatNoLongerResolvesStopsTheRollbackAndWritesNothing() throws Exception {
        String resource = JSON.readTree(mvc.perform(post("/v1/projects/{p}/resources", PROJECT)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("name", "crm.yaml", "kind", "TOOL_SERVER",
                                "contentType", "application/yaml", "contentBase64", base64(CRM)))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("id").asText();
        deploy(tooled("tooled", "        - crm/get_customer\n"));
        deploy(tooled("tooled", "        - crm/other\n"));

        long revision = context.getBean(ProjectResourceRepository.class).findById(resource).orElseThrow()
                .getEntityVersion();
        mvc.perform(put("/v1/projects/{p}/resources/{r}", PROJECT, resource).contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("expectedRevision", revision,
                                "contentType", "application/yaml",
                                "contentBase64", base64(CRM.replace("  get_customer:  { policy: read }\n", ""))))))
                .andExpect(status().isOk());

        mvc.perform(post("/v1/projects/{p}/processes/tooled/versions/1/rollback", PROJECT)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("comment", "Try the old one"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.details.issues[0].code").value("ABADA-APL-TOOL-002"));
        mvc.perform(get("/v1/projects/{p}/processes/tooled/versions", PROJECT))
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    @Order(4)
    void twoRollbacksAtOnceGiveOneNewVersionAndOneRefusal() throws Exception {
        deploy(plain("race", "a"));
        deploy(plain("race", "b"));
        Callable<Integer> attempt = () -> mvc.perform(post("/v1/projects/{p}/processes/race/versions/1/rollback",
                        PROJECT).contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("comment", "go", "expectedLatest", 2))))
                .andReturn().getResponse().getStatus();
        var pool = Executors.newFixedThreadPool(2);
        try {
            var first = pool.submit(attempt);
            var second = pool.submit(attempt);
            assertThat(List.of(first.get(), second.get())).containsExactlyInAnyOrder(200, 409);
        } finally {
            pool.shutdownNow();
        }
        mvc.perform(get("/v1/projects/{p}/processes/race/versions", PROJECT))
                .andExpect(jsonPath("$.length()").value(3)).andExpect(jsonPath("$[0].version").value(3));
    }

    @Test
    @Order(5)
    void theDiffShowsWhatChangedBetweenTwoVersions() throws Exception {
        mvc.perform(get("/v1/projects/{p}/processes/loan/versions/1/diff/2", PROJECT))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identical").value(false))
                .andExpect(jsonPath("$.unified").value(org.hamcrest.Matchers.allOf(
                        org.hamcrest.Matchers.containsString("-      prompt: first wording"),
                        org.hamcrest.Matchers.containsString("+      prompt: second wording"))));
        mvc.perform(get("/v1/projects/{p}/processes/loan/versions/1/diff/3", PROJECT))
                .andExpect(jsonPath("$.identical").value(true));
    }

    @Test
    @Order(6)
    void aStrangerCannotSeeOrRollBack() throws Exception {
        mvc.perform(get("/v1/projects/{p}/processes/loan/versions", PROJECT).header("X-User", "mallory"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/v1/projects/{p}/processes/loan/versions/1/rollback", PROJECT).header("X-User", "mallory")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("comment", "x"))))
                .andExpect(status().isNotFound());
    }

    private static com.abada.engine.persistence.entity.ProcessDefinitionEntity deploy(String source) {
        return context.getBean(AbadaEngine.class).deploy(PROJECT,
                new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)));
    }

    private static String base64(String value) {
        return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String plain(String key, String wording) {
        return """
                version: abada.io/v1
                metadata: { key: %s, name: %s }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: triage }
                    - id: triage
                      type: agent
                      model: gemini-3.6-flash
                      prompt: %s
                      next: done
                    - { id: done, type: end }
                """.formatted(key, key, wording);
    }

    private static String tooled(String key, String tools) {
        return """
                version: abada.io/v1
                metadata: { key: %s, name: %s }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: triage }
                    - id: triage
                      type: agent
                      model: gemini-3.6-flash
                      prompt: Triage
                      tools:
                """.formatted(key, key) + tools + """
                      next: done
                    - { id: done, type: end }
                """;
    }
}
