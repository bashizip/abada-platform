package com.abada.engine.parser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.AgentWorkDescriptor;
import com.abada.engine.core.model.ToolPolicy;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** E7: agent {@code tools:} entries as {@code <server>/<tool>} or {@code { ref, policy }}. */
class AplToolReferenceTest {
    private final AplParser parser = new AplParser();

    @Test
    void acceptsBothFormsAndKeepsTightenedPolicies() {
        var result = parser.parseDetailed(agentWithTools("""
                        - crm/get_customer
                        - { ref: crm/create_ticket, policy: approval_required }
                """));
        AgentWorkDescriptor work = result.definition().getServiceTask("triage").agentWork();
        assertThat(work.tools()).containsExactly("crm/get_customer", "crm/create_ticket");
        assertThat(work.toolPolicies()).containsExactly(
                java.util.Map.entry("crm/create_ticket", ToolPolicy.APPROVAL_REQUIRED));
        assertThat(work.toolBindings()).isEmpty();
        assertThat(result.report().issues()).noneMatch(issue -> issue.code().startsWith("ABADA-APL-TOOL"));
    }

    @Test
    void aNameWithoutAServerIsAnAdvisoryWarning() {
        var result = parser.parseDetailed(agentWithTools("""
                        - web_search
                """));
        assertThat(result.report().issues())
                .filteredOn(issue -> AplParser.TOOL_ADVISORY_CODE.equals(issue.code()))
                .singleElement()
                .satisfies(issue -> {
                    assertThat(issue.severity()).isEqualTo(ValidationSeverity.WARNING);
                    assertThat(issue.elementId()).isEqualTo("triage");
                    assertThat(issue.path()).isEqualTo("/flow/nodes/1/tools/0");
                });
    }

    @Test
    void rejectsMalformedEntriesAtTheirPath() {
        assertThat(errors("""
                        - { ref: crm, policy: read }
                """)).extracting(BpmnValidationIssue::path).containsExactly("/flow/nodes/1/tools/0/ref");
        assertThat(errors("""
                        - { ref: crm/get_customer, policy: delete }
                """)).extracting(BpmnValidationIssue::path).containsExactly("/flow/nodes/1/tools/0/policy");
        assertThat(errors("""
                        - crm/get_customer
                        - crm/get_customer
                """)).extracting(BpmnValidationIssue::path).containsExactly("/flow/nodes/1/tools/1");
        assertThat(errors("""
                        - Crm/get_customer
                """)).extracting(BpmnValidationIssue::path).containsExactly("/flow/nodes/1/tools/0");
    }

    @Test
    void loopLimitsDefaultOnlyWhereToolsAreBoundAndAreBounded() {
        var bound = parser.parse(agentWithTools("        - crm/get_customer\n"))
                .getServiceTask("triage").agentWork().limits();
        assertThat(bound.maxTurns()).isEqualTo(8);
        assertThat(bound.maxTokensTotal()).isEqualTo(50_000L);
        assertThat(bound.budgetUsd()).isNull();
        var advisory = parser.parse(agentWithTools("        - web_search\n"))
                .getServiceTask("triage").agentWork().limits();
        assertThat(advisory.maxTokensTotal()).isNull();

        byte[] tooMany = withField("max_turns: 33");
        assertThatThrownBy(() -> parser.parseDetailed(tooMany)).isInstanceOfSatisfying(BpmnValidationException.class,
                error -> assertThat(error.getIssues()).anyMatch(issue -> "/flow/nodes/1/max_turns".equals(issue.path())));
        assertThat(parser.parse(withField("budget_usd: 0.5")).getServiceTask("triage").agentWork().limits().budgetUsd())
                .isEqualByComparingTo("0.5");
        assertThat(parser.parse(withField("max_tokens_total: 900")).getServiceTask("triage").agentWork().limits()
                .maxTokensTotal()).isEqualTo(900L);
    }

    private static byte[] withField(String field) {
        return new String(agentWithTools("        - crm/get_customer\n"), StandardCharsets.UTF_8)
                .replace("      next: done", "      " + field + "\n      next: done").getBytes(StandardCharsets.UTF_8);
    }

    private java.util.List<BpmnValidationIssue> errors(String tools) {
        try {
            parser.parseDetailed(agentWithTools(tools));
        } catch (BpmnValidationException exception) {
            return exception.getIssues().stream()
                    .filter(issue -> issue.severity() == ValidationSeverity.ERROR).toList();
        }
        return org.junit.jupiter.api.Assertions.fail("expected a validation error");
    }

    private static byte[] agentWithTools(String tools) {
        return ("""
                version: abada.io/v1
                metadata: { key: tool_agent, name: Tool agent }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: triage }
                    - id: triage
                      type: agent
                      model: gemini-3.6-flash
                      prompt: Triage the request
                      tools:
                """ + tools + """
                      next: done
                    - { id: done, type: end }
                """).getBytes(StandardCharsets.UTF_8);
    }
}
