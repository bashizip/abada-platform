package com.abada.engine.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
class SecurityAuthorizationContractTest {
    @Autowired MockMvc mvc;
    @Autowired CommonsRequestLoggingFilter requestLoggingFilter;
    @MockitoBean JwtDecoder jwtDecoder;

    @BeforeEach
    void configureJwtDecoder() {
        when(jwtDecoder.decode(anyString())).thenAnswer(invocation -> jwt(invocation.getArgument(0)));
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
            default -> "";
        };
        return Jwt.withTokenValue(token).header("alg", "RS256").subject("user-1")
                .claim("preferred_username", "alice").claim("groups", List.of("customers"))
                .claim("scope", scope).issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(300)).build();
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
    void readinessIsPublicButDoesNotExposeProtectedApis() throws Exception {
        mvc.perform(get("/actuator/health/readiness")).andExpect(status().isOk());
        mvc.perform(get("/v1/tasks")).andExpect(status().isUnauthorized());
    }

    @Test
    void enforcesEveryPermissionBoundary() throws Exception {
        assertForbidden(post("/v1/processes/deploy").contentType(MediaType.MULTIPART_FORM_DATA), "tasks");
        assertForbidden(post("/v1/processes/start").param("processId", "missing"), "tasks");
        assertForbidden(post("/v1/tasks/claim").param("taskId", "missing"), "operator");
        assertForbidden(get("/v1/process-instances/missing/history"), "tasks");
        assertForbidden(post("/v1/external-tasks/fetch-and-lock").contentType(MediaType.APPLICATION_JSON)
                .content("{\"workerId\":\"w\",\"topics\":[\"topic\"],\"lockDuration\":1000}"), "operator");
    }

    @Test
    void permitsReadOperationsForMatchingScopes() throws Exception {
        mvc.perform(get("/v1/tasks").header("Authorization", "Bearer tasks"))
                .andExpect(status().isOk());
        mvc.perform(get("/v1/jobs").header("Authorization", "Bearer operator"))
                .andExpect(status().isOk());
        mvc.perform(post("/v1/external-tasks/fetch-and-lock").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"workerId\":\"w\",\"topics\":[\"topic\"],\"lockDuration\":1000}")
                        .header("Authorization", "Bearer worker"))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Abada-Worker-Protocol-Version", "1"));
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
