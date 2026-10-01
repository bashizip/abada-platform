package com.abada.engine.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import com.abada.engine.persistence.entity.AiProviderEntity;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.ProjectWorkerBindingEntity;
import com.abada.engine.persistence.repository.AiProviderRepository;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.persistence.repository.WorkerCapabilityRepository;
import com.abada.engine.persistence.repository.ProjectWorkerBindingRepository;
import com.abada.engine.project.ProjectConstants;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.filter.CommonsRequestLoggingFilter;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@SpringBootTest(properties = {
        "abada.security.mode=oidc",
        "abada.security.allowed-origins=https://tenda.example",
        "spring.security.oauth2.resourceserver.jwt.issuer-uri=https://identity.test/realms/abada",
        "abada.security.audience=abada-api"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@ExtendWith(OutputCaptureExtension.class)
class SecurityAuthorizationContractTest {
    private static final String PROVIDER_KEY = "sk-test-provider-key-91c2";
    @Autowired MockMvc mvc;
    @Autowired CommonsRequestLoggingFilter requestLoggingFilter;
    @Autowired PrincipalRepository principals;
    @Autowired ProjectWorkerBindingRepository workerBindings;
    @Autowired WorkerCapabilityRepository workerCapabilities;
    @Autowired AiProviderRepository aiProviders;
    @Autowired com.abada.engine.security.AesEncryption encryption;
    @MockitoBean JwtDecoder jwtDecoder;

    @BeforeEach
    void configureJwtDecoder() {
        when(jwtDecoder.decode(anyString())).thenAnswer(invocation -> jwt(invocation.getArgument(0)));
        PrincipalEntity worker = principals.findByIssuerAndSubjectId("oidc", "worker-1")
                .orElseGet(PrincipalEntity::new);
        worker.setIssuer("oidc");
        worker.setSubjectId("worker-1");
        worker.setUsername("service-account-test-worker");
        worker.setPrincipalType(PrincipalEntity.Type.SERVICE);
        if (worker.getFirstSeenAt() == null) worker.setFirstSeenAt(Instant.now());
        worker.setLastSeenAt(Instant.now());
        worker = principals.save(worker);
        if (workerBindings.findByProjectIdAndPrincipalId(ProjectConstants.DEFAULT_PROJECT_ID,
                worker.getId()).isEmpty()) {
            ProjectWorkerBindingEntity binding = new ProjectWorkerBindingEntity();
            binding.setProjectId(ProjectConstants.DEFAULT_PROJECT_ID);
            binding.setPrincipalId(worker.getId());
            binding.setTopics("topic");
            binding.setCreatedAt(Instant.now());
            binding.setCreatedBy("test");
            workerBindings.save(binding);
        }
    }

    private Jwt jwt(String token) {
        if ("invalid".equals(token)) throw invalid("JWT signature is invalid");
        if ("expired".equals(token)) throw invalid("JWT has expired");
        String scope = switch (token) {
            case "deployer" -> "process:deploy";
            case "controller" -> "process:control process:read";
            case "tasks" -> "task:read task:write process:read";
            case "operator" -> "operations:read operations:write process:read";
            case "worker" -> "worker:execute";
            case "insight-reader" -> "insight:read";
            case "insight-reviewer" -> "insight:read insight:review";
            case "insight-admin" -> "insight:read insight:review insight:configure";
            default -> "";
        };
        var builder = Jwt.withTokenValue(token).header("alg", "RS256")
                .subject("worker".equals(token) ? "worker-1" : "user-1")
                .claim("preferred_username", "worker".equals(token)
                        ? "service-account-test-worker" : "alice")
                .claim("groups", "admin".equals(token) ? List.of("abada-admin") : List.of("customers"))
                .claim("scope", scope)
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(300));
        if ("worker".equals(token)) builder.claim("client_id", "test-worker");
        return builder.build();
    }

    private JwtValidationException invalid(String message) {
        return new JwtValidationException(message,
                List.of(new OAuth2Error("invalid_token", message, null)));
    }

    @Test
    void rejectsMissingInvalidExpiredAndForgedProxyCredentialsWithTypedErrors() throws Exception {
        mvc.perform(get("/v1/tasks").header("X-Auth-Request-User", "forged-admin"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
        mvc.perform(get("/v1/tasks").header("Authorization", "Bearer invalid"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
        mvc.perform(get("/v1/tasks").header("Authorization", "Bearer expired"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
    }

    @Test
    void aplContractRequiresAuthenticationButNoRole() throws Exception {
        String body = "{\"source\":\"version: abada.io/v1\"}";
        mvc.perform(get("/v1/apl/schema")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
        mvc.perform(get("/v1/apl/schema").header("X-Auth-Request-User", "forged-admin"))
                .andExpect(status().isUnauthorized());
        for (String token : List.of("invalid", "expired")) {
            mvc.perform(post("/v1/apl/validate").header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
        }
        mvc.perform(post("/v1/apl/validate").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());

        // A signed-in user without any Abada role or scope may read the contract and validate drafts.
        mvc.perform(get("/v1/apl/schema").header("Authorization", "Bearer viewer"))
                .andExpect(status().isOk());
        mvc.perform(post("/v1/apl/validate").header("Authorization", "Bearer viewer")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false));
    }

    @Test
    void readinessIsPublicButDoesNotExposeProtectedApis() throws Exception {
        mvc.perform(get("/actuator/health/readiness")).andExpect(status().isOk());
        mvc.perform(get("/v1/tasks")).andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/projects/" + ProjectConstants.DEFAULT_PROJECT_ID + "/authoring/generate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"prompt\":\"Create an approval flow\",\"mode\":\"CREATE\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
    }

    @Test
    void enforcesEveryPermissionBoundary() throws Exception {
        assertForbidden(post("/v1/processes/deploy").contentType(MediaType.MULTIPART_FORM_DATA), "tasks");
        assertForbidden(post("/v1/processes/start").param("processId", "missing"), "tasks");
        assertForbidden(post("/v1/tasks/claim").param("taskId", "missing"), "operator");
        assertForbidden(get("/v1/process-instances/missing/history"), "tasks");
        assertForbidden(post("/v1/external-tasks/fetch-and-lock").contentType(MediaType.APPLICATION_JSON)
                .content("{\"workerId\":\"w\",\"topics\":[\"topic\"],\"lockDuration\":1000}"), "operator");
        assertForbidden(get("/v1/insight/proposals"), "tasks");
        assertForbidden(post("/v1/insight/proposals/999/reviews")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"APPROVE\"}"), "insight-reader");
        assertForbidden(put("/v1/insight/policies/order_flow")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"requiredApprovals\":1,\"requiredGroups\":\"reviewers\","
                        + "\"approvalMode\":\"PARALLEL\"}"), "insight-reviewer");
        // AI provider config endpoints require insight:configure scope
        assertForbidden(put("/v1/insight/config/ai")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"baseUrl\":\"https://api.openai.com/v1\",\"model\":\"gpt-4o\"}"),
                "insight-reader");
        assertForbidden(put("/v1/insight/config/ai")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"baseUrl\":\"https://api.openai.com/v1\",\"model\":\"gpt-4o\"}"),
                "insight-reviewer");
        assertForbidden(post("/v1/insight/config/ai/test")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"baseUrl\":\"https://api.openai.com/v1\",\"model\":\"gpt-4o\"}"),
                "insight-reader");
        assertForbidden(post("/v1/insight/config/ai/test")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"baseUrl\":\"https://api.openai.com/v1\",\"model\":\"gpt-4o\"}"),
                "insight-reviewer");
        assertForbidden(post("/v1/insight/config/llm/test"), "insight-reader");
        assertForbidden(post("/v1/insight/config/llm/test"), "insight-reviewer");
    }

    @Test
    void permitsReadOperationsForMatchingScopes() throws Exception {
        mvc.perform(get("/v1/tasks").header("Authorization", "Bearer tasks"))
                .andExpect(status().isOk());
        mvc.perform(get("/v1/jobs").header("Authorization", "Bearer operator"))
                .andExpect(status().isOk());
        mvc.perform(post("/v1/external-tasks/fetch-and-lock").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"workerId\":\"w\",\"topics\":[\"topic\"],\"lockDuration\":1000,"
                                + "\"projectId\":\"" + ProjectConstants.DEFAULT_PROJECT_ID + "\"}")
                        .header("Authorization", "Bearer worker"))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Abada-Worker-Protocol-Version", "1"));
        mvc.perform(get("/v1/insight/policies/order_flow")
                        .header("Authorization", "Bearer insight-reader"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requiredApprovals").value(1));
        mvc.perform(post("/v1/insight/proposals/999/reviews")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"APPROVE\"}")
                        .header("Authorization", "Bearer insight-reviewer"))
                .andExpect(status().isNotFound());
    }

    @Test
    void workerCanRegisterGlobalCapabilitiesAndFetchWithoutProject() throws Exception {
        mvc.perform(put("/v1/workers/me").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"topics\":[\"global-topic\"],\"models\":[]}")
                        .header("Authorization", "Bearer worker"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capabilities[0].topic").value("global-topic"));

        mvc.perform(post("/v1/external-tasks/fetch-and-lock").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"workerId\":\"w\",\"topics\":[\"global-topic\"],\"lockDuration\":1000}")
                        .header("Authorization", "Bearer worker"))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Abada-Worker-Protocol-Version", "1"));

        mvc.perform(get("/v1/workers/health")
                        .header("Authorization", "Bearer worker"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.topic == 'global-topic' && @.bound == true)]").isNotEmpty());
    }

    @Test
    void globalFetchRequiresARegisteredCapabilityAndWorkerRole() throws Exception {
        assertForbidden(post("/v1/external-tasks/fetch-and-lock").contentType(MediaType.APPLICATION_JSON)
                .content("{\"workerId\":\"w\",\"topics\":[\"unregistered-topic\"],\"lockDuration\":1000}"),
                "worker");
        assertForbidden(put("/v1/workers/me").contentType(MediaType.APPLICATION_JSON)
                .content("{\"topics\":[\"t\"],\"models\":[]}"), "operator");
    }

    @Test
    void aiCredentialsAreServedOnlyToAnAgentWorkerAndNeverLogged(CapturedOutput output) throws Exception {
        seedProvider();
        mvc.perform(put("/v1/workers/me").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"topics\":[\"abada:agent\"],\"models\":[]}")
                        .header("Authorization", "Bearer worker"))
                .andExpect(status().isOk());

        mvc.perform(get("/v1/workers/me/ai-credentials").header("Authorization", "Bearer worker"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")))
                .andExpect(jsonPath("$.revision").isString())
                .andExpect(jsonPath("$.providers[0].id").value("gemini"))
                .andExpect(jsonPath("$.providers[0].apiKey").value(PROVIDER_KEY))
                .andExpect(jsonPath("$.providers[0].baseUrl")
                        .value("https://generativelanguage.googleapis.com/v1beta/openai"));

        assertThat(output.getAll()).contains("ai_credentials_issued providers=gemini")
                .doesNotContain(PROVIDER_KEY);
    }

    @Test
    void aiCredentialsAreDeniedToEveryoneElse() throws Exception {
        seedProvider();
        mvc.perform(get("/v1/workers/me/ai-credentials"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/workers/me/ai-credentials").header("X-Auth-Request-User", "forged-worker")
                        .header("X-Auth-Request-Groups", "abada-worker"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/workers/me/ai-credentials").header("Authorization", "Bearer invalid"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/workers/me/ai-credentials").header("Authorization", "Bearer expired"))
                .andExpect(status().isUnauthorized());
        assertForbidden(get("/v1/workers/me/ai-credentials"), "admin");
        assertForbidden(get("/v1/workers/me/ai-credentials"), "insight-admin");
        assertForbidden(get("/v1/workers/me/ai-credentials"), "operator");

        String workerId = principals.findByIssuerAndSubjectId("oidc", "worker-1").orElseThrow().getId();
        workerCapabilities.findByPrincipalIdAndTopic(workerId, "abada:agent").ifPresent(workerCapabilities::delete);
        assertForbidden(get("/v1/workers/me/ai-credentials"), "worker");
    }

    @Test
    void aiProviderManagementRequiresInsightConfigure() throws Exception {
        assertForbidden(put("/v1/ai-providers/gemini").contentType(MediaType.APPLICATION_JSON)
                .content("{\"apiKey\":\"k\"}"), "insight-reviewer");
        assertForbidden(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .delete("/v1/ai-providers/gemini"), "insight-reader");
        assertForbidden(post("/v1/ai-providers/gemini/test"), "insight-reader");
        assertForbidden(get("/v1/ai-providers"), "tasks");
        mvc.perform(get("/v1/ai-providers").header("Authorization", "Bearer insight-reader"))
                .andExpect(status().isOk());
        mvc.perform(get("/v1/ai-providers/status").param("model", "gemini-3.6-flash")
                        .header("Authorization", "Bearer tasks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unconfiguredModels").isArray());
        mvc.perform(put("/v1/ai-providers/anthropic").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"providerType\":\"anthropic\",\"apiKey\":\"k\"}")
                        .header("Authorization", "Bearer admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.apiKeyHint").value("****"));
        aiProviders.deleteById("anthropic");
    }

    private void seedProvider() {
        AiProviderEntity provider = aiProviders.findById("gemini").orElseGet(AiProviderEntity::new);
        provider.setId("gemini");
        provider.setDisplayName("Google Gemini");
        provider.setProviderType("gemini");
        provider.setApiKeyEnc(encryption.encrypt(PROVIDER_KEY));
        provider.setApiKeyHint("****91c2");
        provider.setInsightDefault(true);
        if (provider.getCreatedAt() == null) provider.setCreatedAt(Instant.now());
        provider.setUpdatedAt(Instant.now());
        aiProviders.save(provider);
    }

    @Test
    void insightConfigWriteAllowedForAdminScope() throws Exception {
        mvc.perform(put("/v1/insight/config/ai")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"baseUrl\":\"https://api.openai.com/v1\",\"model\":\"gpt-4o\","
                                + "\"enabled\":true}")
                        .header("Authorization", "Bearer insight-admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.configured").value(false));
        mvc.perform(post("/v1/insight/config/ai/test")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"baseUrl\":\"https://api.openai.com/v1\",\"model\":\"gpt-4o\"}")
                        .header("Authorization", "Bearer insight-admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").exists());
        mvc.perform(post("/v1/insight/config/llm/test")
                        .header("Authorization", "Bearer insight-admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").exists());
    }

    @Test
    void restrictsCorsToConfiguredOrigins() throws Exception {
        mvc.perform(options("/v1/tasks").header("Origin", "https://tenda.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://tenda.example"));
        mvc.perform(options("/v1/tasks").header("Origin", "https://evil.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden());
    }

    @Test
    void requestLoggingCannotCaptureHeadersOrPayloads() {
        assertThat(ReflectionTestUtils.getField(requestLoggingFilter, "includeHeaders")).isEqualTo(false);
        assertThat(ReflectionTestUtils.getField(requestLoggingFilter, "includePayload")).isEqualTo(false);
    }

    private void assertForbidden(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
            String token) throws Exception {
        mvc.perform(request.header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
    }
}
