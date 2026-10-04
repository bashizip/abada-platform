package com.abada.engine.tools;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.model.ToolBinding;
import com.abada.engine.core.model.ToolPolicy;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.persistence.repository.ToolCredentialRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * E7 under the PostgreSQL authority: tool server documents are checked on
 * save, references resolve at deployment, bindings stay frozen with the
 * definition version, and credentials reach only the lease holder.
 */
@Testcontainers
@ExtendWith(OutputCaptureExtension.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PostgresToolRegistryTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static String PROJECT;
    private static final String SECRET = "mcp-secret-value-91c2";
    private static final String CRM = """
            name: crm
            transport: streamable-http
            url: https://crm-mcp.internal/mcp
            credential: crm-token
            tools:
              get_customer:  { policy: read }
              create_ticket: { policy: write, idempotency: key }
              refund:        { policy: approval_required, idempotency: none, approvers: [finance] }
            """;

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_tools").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;
    private static MockMvc mvc;
    private static String crmResourceId;

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
                        "spring.datasource.hikari.maximum-pool-size=3",
                        "spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect",
                        "spring.jpa.hibernate.ddl-auto=validate",
                        "spring.jpa.open-in-view=false",
                        "spring.flyway.enabled=true",
                        "spring.task.scheduling.enabled=false",
                        "abada.outbox.dispatcher.enabled=false",
                        "abada.security.mode=disabled",
                        // A configured provider; no model is ever called (the test acts as the worker).
                        "abada.insight.llm.base-url=http://llm.test.invalid/v1",
                        "abada.insight.llm.api-key=test-key",
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
        mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context)
                .defaultRequest(get("/").header("X-User", "alice")).build();
        PROJECT = JSON.readTree(mvc.perform(post("/v1/projects").contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("slug", "tools", "name", "Tools", "description", ""))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("id").asText();
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    @Order(1)
    void invalidToolServerDocumentsAreRejectedOnSave() throws Exception {
        mvc.perform(createResource("broken.yaml", CRM.replace("{ policy: write, idempotency: key }",
                        "{ policy: write }")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.details.issues[0].path").value("/tools/create_ticket/idempotency"));
        mvc.perform(createResource("stdio.yaml", CRM.replace("streamable-http", "stdio")))
                .andExpect(status().isBadRequest());

        JsonNode created = JSON.readTree(mvc.perform(createResource("crm.yaml", CRM))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        crmResourceId = created.path("id").asText();
        assertThat(crmResourceId).isNotBlank();

        // Server names are unique per project, whatever the file is called.
        mvc.perform(createResource("crm-copy.yaml", CRM))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.details.issues[0].path").value("/name"));
    }

    @Test
    @Order(2)
    void unresolvableReferencesAndLoosenedPoliciesStopTheDeployment() {
        assertThat(deploymentErrors(agent("unresolved", """
                        - crm/get_customer
                        - crm/delete_everything
                        - billing/charge
                """))).extracting(BpmnValidationIssue::code, BpmnValidationIssue::path)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("ABADA-APL-TOOL-002", "/flow/nodes/1/tools/1"),
                        org.assertj.core.groups.Tuple.tuple("ABADA-APL-TOOL-002", "/flow/nodes/1/tools/2"));
        assertThat(deploymentErrors(agent("loosened", """
                        - { ref: crm/create_ticket, policy: read }
                """))).extracting(BpmnValidationIssue::path).containsExactly("/flow/nodes/1/tools/0/policy");
    }

    @Test
    @Order(3)
    void validationWithAProjectResolvesToolsLikeDeployment() throws Exception {
        String source = agent("validated", """
                        - crm/unknown_tool
                """);
        mvc.perform(post("/v1/apl/validate").contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("source", source))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.valid").value(true));
        mvc.perform(post("/v1/apl/validate").contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("source", source, "projectId", PROJECT))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.issues[0].code").value("ABADA-APL-TOOL-002"))
                .andExpect(jsonPath("$.issues[0].path").value("/flow/nodes/1/tools/0"));
    }

    @Test
    @Order(4)
    void bindingsAreFrozenWithTheDefinitionVersion() throws Exception {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String source = agent("frozen", """
                        - crm/get_customer
                        - { ref: crm/create_ticket, policy: approval_required }
                        - web_search
                """);
        ProcessDefinitionEntity first = deploy(source);
        String before = engine.startProcess(PROJECT, "frozen", "alice", Map.of()).getId();

        // The server tightens get_customer after the deployment.
        String revised = CRM.replace("get_customer:  { policy: read }",
                "get_customer:  { policy: write, idempotency: none }");
        long revision = context.getBean(com.abada.engine.persistence.repository.ProjectResourceRepository.class)
                .findById(crmResourceId).orElseThrow().getEntityVersion();
        mvc.perform(put("/v1/projects/{p}/resources/{r}", PROJECT, crmResourceId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("expectedRevision", revision,
                                "contentType", "application/yaml", "contentBase64", base64(revised)))))
                .andExpect(status().isOk());

        // Same source, changed server: a new version. Unchanged source and server: no new version.
        ProcessDefinitionEntity second = deploy(source);
        assertThat(second.getVersion()).isEqualTo(first.getVersion() + 1);
        assertThat(deploy(source).getVersion()).isEqualTo(second.getVersion());
        String after = engine.startProcess(PROJECT, "frozen", "alice", Map.of()).getId();

        Map<String, LockedExternalTask> locked = lockAll("frozen-worker");
        List<ToolBinding> old = locked.get(before).agentWork().toolBindings();
        List<ToolBinding> current = locked.get(after).agentWork().toolBindings();

        assertThat(old).extracting(ToolBinding::ref, ToolBinding::policy).containsExactly(
                org.assertj.core.groups.Tuple.tuple("crm/get_customer", ToolPolicy.READ),
                org.assertj.core.groups.Tuple.tuple("crm/create_ticket", ToolPolicy.APPROVAL_REQUIRED));
        assertThat(current).extracting(ToolBinding::ref, ToolBinding::policy).containsExactly(
                org.assertj.core.groups.Tuple.tuple("crm/get_customer", ToolPolicy.WRITE),
                org.assertj.core.groups.Tuple.tuple("crm/create_ticket", ToolPolicy.APPROVAL_REQUIRED));
        assertThat(old.get(1).idempotency()).isEqualTo("key");
        assertThat(old.get(0).credential()).isEqualTo("crm-token");
        assertThat(old.get(0).resourceRevision()).isLessThan(current.get(0).resourceRevision());
        // The advisory name is passed on, but never bound.
        assertThat(locked.get(before).agentWork().tools()).contains("web_search");
    }

    @Test
    @Order(5)
    void credentialsAreWriteOnlyAndReachOnlyTheLeaseHolder(CapturedOutput output) throws Exception {
        mvc.perform(put("/v1/projects/{p}/tool-credentials/crm-token", PROJECT)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("secret", SECRET))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("crm-token"))
                .andExpect(jsonPath("$.hint").value("****91c2"))
                .andExpect(jsonPath("$.secret").doesNotExist());
        String listed = mvc.perform(get("/v1/projects/{p}/tool-credentials", PROJECT))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(listed).contains("crm-token").doesNotContain(SECRET);
        assertThat(context.getBean(ToolCredentialRepository.class).findAll())
                .allSatisfy(row -> assertThat(row.getSecretEnc()).doesNotContain(SECRET));

        AbadaEngine engine = context.getBean(AbadaEngine.class);
        deploy(agent("credentialed", """
                        - crm/get_customer
                """));
        String instance = engine.startProcess(PROJECT, "credentialed", "alice", Map.of()).getId();
        LockedExternalTask task = lockAll("holder").get(instance);

        mvc.perform(get("/v1/external-tasks/{id}/tool-credentials/crm", task.id()).param("workerId", "holder"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.credential").value("crm-token"))
                .andExpect(jsonPath("$.secret").value(SECRET));
        mvc.perform(get("/v1/external-tasks/{id}/tool-credentials/crm", task.id()).param("workerId", "intruder"))
                .andExpect(status().isConflict());
        mvc.perform(get("/v1/external-tasks/{id}/tool-credentials/billing", task.id()).param("workerId", "holder"))
                .andExpect(status().isForbidden());

        context.getBean(ExternalTaskCommandService.class).complete(task.id(), "holder",
                Map.of("triage_result", "done"));
        mvc.perform(get("/v1/external-tasks/{id}/tool-credentials/crm", task.id()).param("workerId", "holder"))
                .andExpect(status().isConflict());

        mvc.perform(delete("/v1/projects/{p}/tool-credentials/crm-token", PROJECT))
                .andExpect(status().isNoContent());
        assertThat(output.getAll()).doesNotContain(SECRET);
    }

    private static Map<String, LockedExternalTask> lockAll(String workerId) {
        List<LockedExternalTask> tasks = context.getBean(ExternalTaskCommandService.class).fetchAndLock(
                new FetchAndLockRequest(workerId, List.of("abada:agent"), 60_000L, 10));
        Map<String, LockedExternalTask> byInstance = new LinkedHashMap<>();
        tasks.forEach(task -> byInstance.put(task.processInstanceId(), task));
        return byInstance;
    }

    private static List<BpmnValidationIssue> deploymentErrors(String source) {
        try {
            deploy(source);
        } catch (BpmnValidationException exception) {
            return exception.getIssues().stream()
                    .filter(issue -> issue.code().startsWith("ABADA-APL-TOOL")).toList();
        }
        return org.junit.jupiter.api.Assertions.fail("deployment should have been rejected");
    }

    private static ProcessDefinitionEntity deploy(String source) {
        return context.getBean(AbadaEngine.class).deploy(PROJECT,
                new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)));
    }

    private static MockHttpServletRequestBuilder createResource(String name, String yaml) throws Exception {
        return post("/v1/projects/{p}/resources", PROJECT).contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(Map.of("name", name, "kind", "TOOL_SERVER",
                        "contentType", "application/yaml", "contentBase64", base64(yaml))));
    }

    private static String base64(String value) {
        return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String agent(String key, String tools) {
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
                      prompt: Triage the request
                      tools:
                """.formatted(key, key) + tools + """
                      next: done
                    - { id: done, type: end }
                """;
    }
}
