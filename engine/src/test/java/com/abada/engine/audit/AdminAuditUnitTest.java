package com.abada.engine.audit;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AdminAuditUnitTest {

    @Test
    void classifiesAdministrativeCallsAndIgnoresTheRest() {
        assertThat(AdminAuditActions.classify("PUT", "/api/v1/ai-providers/gemini")).contains(
                new AdminAuditActions.Classified(AdminAuditActions.AI_PROVIDER_SAVE,
                        AdminAuditActions.TARGET_AI_PROVIDER, "gemini", null));
        assertThat(AdminAuditActions.classify("DELETE", "/v1/projects/p1/members/u9")).contains(
                new AdminAuditActions.Classified(AdminAuditActions.PROJECT_MEMBER_REMOVE,
                        AdminAuditActions.TARGET_PRINCIPAL, "u9", "p1"));
        assertThat(AdminAuditActions.classify("PUT", "/v1/admin/users/u1/groups/g1")).get()
                .extracting(AdminAuditActions.Classified::action).isEqualTo(AdminAuditActions.USER_GROUP_ASSIGN);
        assertThat(AdminAuditActions.classify("PUT", "/v1/admin/users/u1")).get()
                .extracting(AdminAuditActions.Classified::action).isEqualTo(AdminAuditActions.USER_UPDATE);
        assertThat(AdminAuditActions.classify("GET", "/v1/admin/audit/export")).get()
                .extracting(AdminAuditActions.Classified::action).isEqualTo(AdminAuditActions.AUDIT_READ);
        assertThat(AdminAuditActions.classify("POST", "/v1/projects/p1/processes/claims/versions/3/rollback"))
                .get().extracting(AdminAuditActions.Classified::targetId).isEqualTo("claims");
        assertThat(AdminAuditActions.classify("GET", "/v1/ai-providers")).isEmpty();
        assertThat(AdminAuditActions.classify("POST", "/v1/projects/p1/tasks/t1/complete")).isEmpty();
        assertThat(AdminAuditActions.ALL).doesNotHaveDuplicates();
    }

    @Test
    void detailsDropSecretsAtAnyDepthAndKeepFlags() {
        Map<String, Object> clean = AdminAuditDetails.create()
                .put("apiKey", "sk-1").put("apiKeyChanged", true).put("password", "p")
                .put("nested", Map.of("clientSecret", "s", "token", "t", "name", "ok",
                        "list", List.of(Map.of("authorization", "Bearer x", "keep", 1))))
                .change("baseUrl", "https://a", "https://b").change("same", 1, 1)
                .sanitized();
        assertThat(clean).containsOnlyKeys("apiKeyChanged", "nested", "baseUrl");
        assertThat(clean.toString()).doesNotContain("sk-1", "Bearer", "\"s\"", "=t,").contains("ok", "keep");
        assertThat(AdminAuditDetails.isSecretName("secretChanged")).isFalse();
        assertThat(AdminAuditDetails.isSecretName("api_key")).isTrue();
        assertThat(AdminAuditDetails.isSecretName("apiKeyEnc")).isTrue();
    }

    @Test
    void csvCellsAreQuotedAndCannotBecomeFormulas() {
        assertThat(AdminAuditController.cell(null)).isEmpty();
        assertThat(AdminAuditController.cell("plain")).isEqualTo("plain");
        assertThat(AdminAuditController.cell("a,b")).isEqualTo("\"a,b\"");
        assertThat(AdminAuditController.cell("say \"hi\"")).isEqualTo("\"say \"\"hi\"\"\"");
        assertThat(AdminAuditController.cell("=SUM(A1)")).isEqualTo("\"'=SUM(A1)\"");
        assertThat(AdminAuditController.cell("@cmd")).isEqualTo("\"'@cmd\"");
    }
}
