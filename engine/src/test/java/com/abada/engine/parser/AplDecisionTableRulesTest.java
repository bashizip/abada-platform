package com.abada.engine.parser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.core.model.DecisionTableMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Rule-level decision-table checks at deployment (M5 S7): each issue names the
 * rule it is about, so the editor can show it on that rule.
 */
class AplDecisionTableRulesTest {
    private final AplParser parser = new AplParser();

    @Test
    void acceptsTheFixtureWithUniqueTiersAndOneFallback() throws Exception {
        try (InputStream stream = getClass().getResourceAsStream("/apl/decision-table-rules.apl.yaml")) {
            ParsedProcessDefinition definition = parser.parse(stream.readAllBytes());
            DecisionTableMeta table = definition.getDecisionTables().get("tier");
            assertThat(table.hitPolicy()).isEqualTo("UNIQUE");
            assertThat(table.rules()).hasSize(3);
            assertThat(table.rules().get(2).otherwise()).isTrue();
        }
    }

    @Test
    void rejectsASecondOtherwiseRuleAtThatRule() {
        List<BpmnValidationIssue> issues = issues("FIRST", """
                - when: score > 700
                  then: { tier: A }
                - otherwise: true
                  then: { tier: B }
                - otherwise: { then: { tier: C } }
                """);
        assertThat(issues).singleElement().satisfies(issue -> {
            assertThat(issue.path()).isEqualTo("/flow/nodes/1/rules/2");
            assertThat(issue.elementId()).isEqualTo("tier");
            assertThat(issue.message()).contains("second otherwise rule (rule 3; rule 2 is already the fallback)");
        });
    }

    @Test
    void rejectsAConditionReadingANameThatIsNotAnInput() {
        List<BpmnValidationIssue> issues = issues("FIRST", """
                - when: score > 700 && income > 50000
                  then: { tier: A }
                - otherwise: true
                  then: { tier: B }
                """);
        assertThat(issues).singleElement().satisfies(issue -> {
            assertThat(issue.path()).isEqualTo("/flow/nodes/1/rules/0/when");
            assertThat(issue.message()).contains("reads income, which is not a declared input (inputs: score)");
        });
    }

    @Test
    void comprehensionVariablesAreNotInputs() {
        assertThat(parser.parse(document("FIRST", "[{ name: tags }]", """
                - when: tags.exists(t, t == "vip")
                  then: { tier: A }
                - otherwise: true
                  then: { tier: B }
                """)).getDecisionTables()).containsKey("tier");
    }

    @Test
    void rejectsInvalidCelAtTheRule() {
        List<BpmnValidationIssue> issues = issues("FIRST", """
                - when: score >
                  then: { tier: A }
                """);
        assertThat(issues).singleElement().satisfies(issue -> {
            assertThat(issue.path()).isEqualTo("/flow/nodes/1/rules/0/when");
            assertThat(issue.message()).contains("rule 1: Invalid expression");
        });
    }

    @Test
    void rejectsAnEmptyCondition() {
        assertThat(issues("FIRST", """
                - when: ""
                  then: { tier: A }
                """)).singleElement().satisfies(issue -> {
            assertThat(issue.path()).isEqualTo("/flow/nodes/1/rules/0/when");
            assertThat(issue.message()).contains("rule 1 has an empty condition");
        });
    }

    @Test
    void rejectsIdenticalConditionsUnderUniqueOnly() {
        String rules = """
                - when: score > 700
                  then: { tier: A }
                - when: "score  >  700"
                  then: { tier: B }
                """;
        assertThat(issues("UNIQUE", rules)).singleElement().satisfies(issue -> {
            assertThat(issue.path()).isEqualTo("/flow/nodes/1/rules/1/when");
            assertThat(issue.message()).contains("rule 2 has the same condition as rule 1");
        });
        // FIRST takes the first match; a duplicate is redundant, not broken.
        assertThat(parser.parse(document("FIRST", "[{ name: score }]", rules)).getDecisionTables()).containsKey("tier");
    }

    @Test
    void reportsEveryBrokenRuleAtOnce() {
        List<BpmnValidationIssue> issues = issues("FIRST", """
                - when: missing > 1
                  then: { tier: A }
                - otherwise: true
                  then: { tier: B }
                - otherwise: true
                  then: { tier: C }
                """);
        assertThat(issues).extracting(BpmnValidationIssue::path)
                .containsExactly("/flow/nodes/1/rules/0/when", "/flow/nodes/1/rules/2");
    }

    @Test
    void storedDefinitionsStillLoadWithoutTheDeploymentChecks() {
        AplParser reload = new AplParser("", false);
        assertThat(reload.parse(document("FIRST", "[{ name: score }]", """
                - otherwise: true
                  then: { tier: B }
                - otherwise: true
                  then: { tier: C }
                """)).getDecisionTables().get("tier").rules()).hasSize(2);
    }

    private List<BpmnValidationIssue> issues(String hitPolicy, String rules) {
        byte[] source = document(hitPolicy, "[{ name: score }]", rules);
        try {
            parser.parseDetailed(source);
        } catch (BpmnValidationException exception) {
            return exception.getIssues();
        }
        throw new AssertionError("expected validation issues");
    }

    private static byte[] document(String hitPolicy, String inputs, String rules) {
        String indented = rules.lines().map(line -> "          " + line).reduce((a, b) -> a + "\n" + b).orElse("");
        return ("""
                version: abada.io/v1
                metadata:
                  key: rules_flow
                  name: Rules flow
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: tier }
                    - id: tier
                      type: decision-table
                      hitPolicy: %s
                      inputs: %s
                      rules:
                %s
                      next: done
                    - { id: done, type: end }
                """.formatted(hitPolicy, inputs, indented)).getBytes(StandardCharsets.UTF_8);
    }
}
