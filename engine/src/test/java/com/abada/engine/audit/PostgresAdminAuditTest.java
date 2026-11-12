package com.abada.engine.audit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * S10 acceptance on PostgreSQL: the trail is append-only, written with the change it
 * describes, records refused calls, never holds a secret, is readable by
 * administrators only, and pages stably while events keep arriving.
 */
@SpringBootTest(properties = {
        "abada.security.mode=oidc",
        "abada.security.allowed-origins=https://studio.example",
        "spring.security.oauth2.resourceserver.jwt.issuer-uri=https://identity.test/realms/abada",
        "abada.security.audience=abada-api"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Testcontainers
class PostgresAdminAuditTest {
    private static final String PROVIDER_KEY = "sk-audit-provider-key-7f3a9c41";
    private static final String TOOL_SECRET = "tool-secret-value-b81e22d0";

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_admin_audit").withUsername("abada").withPassword("abada");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.jpa.database-platform", () -> "org.hibernate.dialect.PostgreSQLDialect");
        registry.add("spring.jpa.show-sql", () -> "false");
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired AdminAuditRecorder recorder;
    @Autowired TransactionTemplate transactions;
    @MockitoBean JwtDecoder jwtDecoder;
    @MockitoBean com.abada.engine.llm.AiProviderGateway aiGateway;

    @BeforeEach
    void tokens() {
        when(jwtDecoder.decode(anyString())).thenAnswer(invocation -> jwt(invocation.getArgument(0)));
    }

    /** {@code root} is an administrator; {@code bob} is signed in with no Abada role. */
    private Jwt jwt(String token) {
        if ("invalid".equals(token)) throw invalid("JWT signature is invalid");
        if ("expired".equals(token)) throw invalid("JWT has expired");
        boolean admin = "root".equals(token);
        return Jwt.withTokenValue(token).header("alg", "RS256")
                .subject(admin ? "admin-1" : "user-2")
                .claim("preferred_username", admin ? "root" : "bob")
                .claim("groups", admin ? List.of("abada-admin") : List.of("customers"))
                .claim("scope", "")
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(300)).build();
    }

    private static JwtValidationException invalid(String message) {
        return new JwtValidationException(message, List.of(new OAuth2Error("invalid_token", message, null)));
    }

    private static String bearer(String token) { return "Bearer " + token; }

    private JsonNode createProject(String name) throws Exception {
        String slug = "audit-" + UUID.randomUUID().toString().substring(0, 8);
        String body = mvc.perform(post("/v1/projects").header("Authorization", bearer("root"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("slug", slug, "name", name))))
                .andExpect(status().is2xxSuccessful())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body);
    }

    private int count(String action, String outcome, String targetId) {
        return jdbc.queryForObject("select count(*) from admin_audit_events where action = ? and outcome = ?"
                + " and target_id = ?", Integer.class, action, outcome, targetId);
    }

    @Test
    void successfulChangesAreRecordedWithActorRolesAndBeforeAfter() throws Exception {
        JsonNode project = createProject("Payroll");
        String id = project.get("id").asText();
        assertThat(count(AdminAuditActions.PROJECT_CREATE, "SUCCESS", id)).isEqualTo(1);

        mvc.perform(put("/v1/projects/" + id).header("Authorization", bearer("root"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("expectedVersion", project.get("version").asLong(),
                                "name", "Payroll declarations"))))
                .andExpect(status().isOk());

        Map<String, Object> row = jdbc.queryForMap("select * from admin_audit_events where action = ?"
                + " and target_id = ? and outcome = 'SUCCESS'", AdminAuditActions.PROJECT_UPDATE, id);
        assertThat(row.get("actor")).isEqualTo("root");
        assertThat(row.get("actor_principal_id")).isNotNull();
        assertThat((String) row.get("actor_roles")).contains("ROLE_ABADA_ADMIN");
        assertThat(row.get("project_id")).isEqualTo(id);
        JsonNode details = json.readTree((String) row.get("details_json"));
        assertThat(details.at("/name/before").asText()).isEqualTo("Payroll");
        assertThat(details.at("/name/after").asText()).isEqualTo("Payroll declarations");
    }

    @Test
    void aFailedMutationLeavesNoSuccessEvent() throws Exception {
        JsonNode project = createProject("Claims");
        String id = project.get("id").asText();
        mvc.perform(put("/v1/projects/" + id).header("Authorization", bearer("root"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("expectedVersion", 999, "name", "Renamed"))))
                .andExpect(status().isConflict());
        assertThat(count(AdminAuditActions.PROJECT_UPDATE, "SUCCESS", id)).isZero();

        // An event recorded inside a transaction that then fails is rolled back with it.
        String target = "rolled-back-" + UUID.randomUUID();
        assertThatThrownBy(() -> transactions.executeWithoutResult(status -> {
            recorder.recordSuccess(AdminAuditActions.PROJECT_UPDATE, AdminAuditActions.TARGET_PROJECT, target,
                    null, AdminAuditDetails.create().put("name", "x"));
            throw new IllegalStateException("the change failed after the event was written");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(count(AdminAuditActions.PROJECT_UPDATE, "SUCCESS", target)).isZero();

        // And a success is never written outside the change's transaction.
        assertThatThrownBy(() -> recorder.recordSuccess(AdminAuditActions.PROJECT_UPDATE,
                AdminAuditActions.TARGET_PROJECT, target, null, null))
                .isInstanceOf(IllegalTransactionStateException.class);
    }

    @Test
    void refusedCallsAreRecordedAsDenied() throws Exception {
        // Refused by the security filter (administrator role required).
        mvc.perform(put("/v1/ai-providers/acme").header("Authorization", bearer("bob"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"providerType\":\"openai\"}"))
                .andExpect(status().isForbidden());
        Map<String, Object> denied = jdbc.queryForMap("select * from admin_audit_events where action = ?"
                + " and target_id = 'acme' and outcome = 'DENIED'", AdminAuditActions.AI_PROVIDER_SAVE);
        assertThat(denied.get("actor")).isEqualTo("bob");
        assertThat((String) denied.get("details_json")).contains("ACCESS_DENIED");

        // Refused by the project role check, which answers 404 to outsiders.
        String id = createProject("Mining permits").get("id").asText();
        mvc.perform(put("/v1/projects/" + id).header("Authorization", bearer("bob"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("expectedVersion", 0, "name", "Mine"))))
                .andExpect(status().isNotFound());
        Map<String, Object> outsider = jdbc.queryForMap("select * from admin_audit_events where action = ?"
                + " and target_id = ? and outcome = 'DENIED'", AdminAuditActions.PROJECT_UPDATE, id);
        assertThat(outsider.get("actor")).isEqualTo("bob");
        assertThat((String) outsider.get("details_json")).contains("NOT_A_MEMBER");

        // Reading the trail without the administrator role.
        mvc.perform(get("/v1/admin/audit").header("Authorization", bearer("bob")))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        assertThat(jdbc.queryForObject("select count(*) from admin_audit_events where action = ?"
                + " and outcome = 'DENIED' and actor = 'bob'", Integer.class, AdminAuditActions.AUDIT_READ))
                .isGreaterThanOrEqualTo(1);
    }

    @Test
    void missingInvalidExpiredAndForgedCredentialsCannotReadTheTrail() throws Exception {
        mvc.perform(get("/v1/admin/audit")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/admin/audit").header("Authorization", bearer("invalid")))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/admin/audit").header("Authorization", bearer("expired")))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/admin/audit").header("X-Auth-Request-User", "forged-admin")
                        .header("X-Auth-Request-Groups", "abada-admin"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/admin/audit/export").header("X-User", "forged-admin")
                        .header("X-Groups", "abada-admin"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/admin/audit").header("Authorization", bearer("root")))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void noSecretValueReachesTheTrail() throws Exception {
        mvc.perform(put("/v1/ai-providers/audit-openai").header("Authorization", bearer("root"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("providerType", "openai",
                                "apiKey", PROVIDER_KEY, "enabled", false))))
                .andExpect(status().isOk());
        String id = createProject("Banking KYC").get("id").asText();
        mvc.perform(put("/v1/projects/" + id + "/tool-credentials/core-banking")
                        .header("Authorization", bearer("root")).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("secret", TOOL_SECRET))))
                .andExpect(status().isOk());

        JsonNode provider = json.readTree(jdbc.queryForObject("select details_json from admin_audit_events"
                + " where action = ? and target_id = 'audit-openai'", String.class,
                AdminAuditActions.AI_PROVIDER_SAVE));
        assertThat(provider.get("apiKeyChanged").asBoolean()).isTrue();
        assertThat(count(AdminAuditActions.TOOL_CREDENTIAL_SAVE, "SUCCESS", "core-banking")).isEqualTo(1);

        String hint = PROVIDER_KEY.substring(PROVIDER_KEY.length() - 4);
        for (Map<String, Object> event : jdbc.queryForList("select * from admin_audit_events")) {
            for (Object value : event.values()) {
                String text = String.valueOf(value);
                assertThat(text).doesNotContain(PROVIDER_KEY).doesNotContain(TOOL_SECRET)
                        .doesNotContain("****" + hint);
            }
        }
    }

    @Test
    void theTableRefusesUpdateDeleteAndTruncateForEveryRole() {
        transactions.executeWithoutResult(status -> recorder.recordSuccess(AdminAuditActions.PROJECT_UPDATE,
                AdminAuditActions.TARGET_PROJECT, "immutable", null, null));
        assertThatThrownBy(() -> jdbc.update("update admin_audit_events set actor = 'mallory'"))
                .rootCause().hasMessageContaining("append-only");
        assertThatThrownBy(() -> jdbc.update("delete from admin_audit_events"))
                .rootCause().hasMessageContaining("append-only");
        assertThatThrownBy(() -> jdbc.execute("truncate admin_audit_events"))
                .rootCause().hasMessageContaining("append-only");
        assertThat(count(AdminAuditActions.PROJECT_UPDATE, "SUCCESS", "immutable")).isEqualTo(1);
    }

    @Test
    void filtersCursorAndCsvExport() throws Exception {
        String marker = "csv-" + UUID.randomUUID();
        for (int i = 0; i < 3; i++) {
            transactions.executeWithoutResult(status -> recorder.recordSuccess(AdminAuditActions.PROCESS_DEPLOY,
                    AdminAuditActions.TARGET_PROCESS, marker, null,
                    AdminAuditDetails.create().put("note", "=HYPERLINK(\"x\")")));
        }
        JsonNode first = json.readTree(mvc.perform(get("/v1/admin/audit").header("Authorization", bearer("root"))
                        .param("targetId", marker).param("limit", "2"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(first.get("items")).hasSize(2);
        assertThat(first.get("nextCursor").isNumber()).isTrue();
        JsonNode second = json.readTree(mvc.perform(get("/v1/admin/audit").header("Authorization", bearer("root"))
                        .param("targetId", marker).param("limit", "2")
                        .param("cursor", first.get("nextCursor").asText()))
                .andReturn().getResponse().getContentAsString());
        assertThat(second.get("items")).hasSize(1);
        assertThat(second.get("nextCursor").isNull()).isTrue();
        assertThat(first.at("/items/0/details/note").asText()).isEqualTo("=HYPERLINK(\"x\")");

        mvc.perform(get("/v1/admin/audit").header("Authorization", bearer("root")).param("outcome", "maybe"))
                .andExpect(status().isBadRequest());

        String csv = mvc.perform(get("/v1/admin/audit/export").header("Authorization", bearer("root"))
                        .param("targetId", marker))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.containsString("attachment")))
                .andReturn().getResponse().getContentAsString();
        String[] lines = csv.split("\r\n");
        assertThat(lines[0]).startsWith("id,occurred_at,actor,");
        assertThat(lines).hasSize(4);
        assertThat(lines[1]).contains(marker).contains("SUCCESS");
    }

    @Test
    void pagesStayStableWhileEventsArrive() throws Exception {
        String marker = "stable-" + UUID.randomUUID();
        for (int i = 0; i < 30; i++) {
            recorder.recordExternalSuccess(AdminAuditActions.GROUP_CREATE, AdminAuditActions.TARGET_GROUP, marker,
                    null);
        }
        Set<Long> before = new HashSet<>(jdbc.queryForList(
                "select id from admin_audit_events where target_id = ?", Long.class, marker));

        ExecutorService writers = Executors.newFixedThreadPool(4);
        AtomicBoolean reading = new AtomicBoolean(true);
        CountDownLatch started = new CountDownLatch(4);
        for (int w = 0; w < 4; w++) {
            writers.submit(() -> {
                started.countDown();
                while (reading.get()) {
                    recorder.recordExternalSuccess(AdminAuditActions.GROUP_CREATE, AdminAuditActions.TARGET_GROUP,
                            marker, null);
                }
                return null;
            });
        }
        started.await(5, TimeUnit.SECONDS);
        List<Long> seen = new ArrayList<>();
        String cursor = null;
        do {
            var request = get("/v1/admin/audit").header("Authorization", bearer("root"))
                    .param("targetId", marker).param("limit", "7");
            if (cursor != null) request.param("cursor", cursor);
            JsonNode page = json.readTree(mvc.perform(request).andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString());
            page.get("items").forEach(item -> seen.add(item.get("id").asLong()));
            cursor = page.get("nextCursor").isNull() ? null : page.get("nextCursor").asText();
        } while (cursor != null);
        reading.set(false);
        writers.shutdown();
        assertThat(writers.awaitTermination(10, TimeUnit.SECONDS)).isTrue();

        assertThat(new HashSet<>(seen)).hasSameSizeAs(seen);
        for (int i = 1; i < seen.size(); i++) assertThat(seen.get(i)).isLessThan(seen.get(i - 1));
        assertThat(seen).containsAll(before);
    }
}
