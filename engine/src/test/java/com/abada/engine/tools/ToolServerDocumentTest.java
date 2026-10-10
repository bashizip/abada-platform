package com.abada.engine.tools;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.core.model.ToolPolicy;
import com.abada.engine.tools.ToolServerDocument.InvalidToolServerException;
import com.abada.engine.tools.ToolServerDocument.Issue;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class ToolServerDocumentTest {
    private static final String VALID = """
            name: crm
            transport: streamable-http
            url: https://crm-mcp.internal/mcp
            credential: crm-mcp-token
            tools:
              get_customer:   { policy: read }
              create_ticket:  { policy: write, idempotency: key }
              refund_payment: { policy: approval_required, idempotency: none, approvers: [finance] }
            """;

    @Test
    void parsesAValidDocument() {
        ToolServerDocument document = parse(VALID, false);
        assertThat(document.name()).isEqualTo("crm");
        assertThat(document.credential()).isEqualTo("crm-mcp-token");
        assertThat(document.tools()).containsOnlyKeys("get_customer", "create_ticket", "refund_payment");
        assertThat(document.tools().get("get_customer").policy()).isEqualTo(ToolPolicy.READ);
        assertThat(document.tools().get("get_customer").idempotency()).isNull();
        assertThat(document.tools().get("create_ticket").idempotency()).isEqualTo("key");
        assertThat(document.tools().get("refund_payment").approvers()).containsExactly("finance");
    }

    @Test
    void writeToolsMustDeclareIdempotency() {
        assertThat(issues(VALID.replace("create_ticket:  { policy: write, idempotency: key }",
                "create_ticket:  { policy: write }")))
                .extracting(Issue::path).containsExactly("/tools/create_ticket/idempotency");
    }

    @Test
    void unknownFieldsAndUnsupportedTransportsAreErrors() {
        assertThat(issues(VALID.replace("transport: streamable-http", "transport: stdio")))
                .extracting(Issue::path).contains("/transport");
        assertThat(issues(VALID + "command: rm -rf /\n")).isNotEmpty();
        assertThat(issues(VALID.replace("{ policy: read }", "{ policy: read, retries: 3 }")))
                .extracting(Issue::path).anyMatch(path -> path.startsWith("/tools/get_customer"));
        assertThat(issues(VALID.replace("{ policy: read }", "{ policy: delete }")))
                .extracting(Issue::path).anyMatch(path -> path.startsWith("/tools/get_customer"));
    }

    @Test
    void plainHttpIsAcceptedForLoopbackOrWhenAllowed() {
        String insecure = VALID.replace("https://crm-mcp.internal/mcp", "http://crm-mcp.internal/mcp");
        assertThat(issues(insecure)).extracting(Issue::path).containsExactly("/url");
        assertThat(parse(insecure, true).url()).startsWith("http://");
        assertThat(parse(VALID.replace("https://crm-mcp.internal/mcp", "http://localhost:8931/mcp"), false).url())
                .isEqualTo("http://localhost:8931/mcp");
    }

    @Test
    void credentialsNeverLiveInTheUrl() {
        assertThat(issues(VALID.replace("https://crm-mcp.internal", "https://user:secret@crm-mcp.internal")))
                .extracting(Issue::path).containsExactly("/url");
    }

    @Test
    void approverSettingsApplyToApprovalRequiredToolsOnly() {
        assertThat(issues(VALID.replace("{ policy: read }", "{ policy: read, approvers: [finance] }")))
                .extracting(Issue::path).containsExactly("/tools/get_customer/approvers");
        assertThat(issues(VALID.replace("{ policy: read }", "{ policy: read, idempotency: key }")))
                .extracting(Issue::path).containsExactly("/tools/get_customer/idempotency");
    }

    @Test
    void emptyAndNonMappingDocumentsAreRejected() {
        assertThat(issues("")).extracting(Issue::path).containsExactly("/");
        assertThat(issues("- a\n- b\n")).extracting(Issue::path).containsExactly("/");
        assertThat(issues("name: [")).extracting(Issue::path).containsExactly("/");
    }

    private static ToolServerDocument parse(String yaml, boolean allowInsecureHttp) {
        return ToolServerDocument.parse(yaml.getBytes(StandardCharsets.UTF_8), allowInsecureHttp);
    }

    private static java.util.List<Issue> issues(String yaml) {
        try {
            parse(yaml, false);
        } catch (InvalidToolServerException exception) {
            return exception.issues();
        }
        return org.junit.jupiter.api.Assertions.fail("expected an invalid document");
    }
}
