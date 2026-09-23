package com.abada.engine.expression;

import org.junit.jupiter.api.Test;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** CEL forms accepted in APL/BPMN conditions and decision tables (T1), and loud failures (T2). */
class WorkflowExpressionsTest {

    private static boolean test(String expression, Map<String, Object> variables) {
        return WorkflowExpressions.compile(expression).test(variables);
    }

    @Test
    void acceptsTheAuthoringFormsUsedInDefinitions() {
        Map<String, Object> vars = Map.of(
                "score", 780, "income", 85_000.5, "riskLevel", "LOW", "approved", true,
                "applicant", Map.of("creditScore", 720, "tags", List.of("vip", "new")),
                "path", "CD");
        assertThat(test("${score >= 750 && income >= 60000}", vars)).isTrue();
        assertThat(test("score >= 750 and income >= 60000", vars)).isTrue();
        assertThat(test("riskLevel == 'LOW'", vars)).isTrue();
        assertThat(test("riskLevel eq \"LOW\"", vars)).isTrue();
        assertThat(test("riskLevel ne 'HIGH' or approved", vars)).isTrue();
        assertThat(test("${!approved}", vars)).isFalse();
        assertThat(test("applicant.creditScore > 700", vars)).isTrue();
        assertThat(test("'vip' in applicant.tags", vars)).isTrue();
        assertThat(test("applicant.tags.exists(t, t == 'new')", vars)).isTrue();
        assertThat(test("has(applicant.creditScore) && !has(applicant.missing)", vars)).isTrue();
        assertThat(test("${path == 'C' || path == 'CD'}", vars)).isTrue();
        assertThat(test("score == 780.0", vars)).isTrue();
        assertThat(test("size(applicant.tags) == 2", vars)).isTrue();
        assertThat(test("<![CDATA[${approved}]]>", vars)).isTrue();
    }

    @Test
    void wordOperatorsInsideStringLiteralsAreKept() {
        assertThat(test("status == 'and or eq'", Map.of("status", "and or eq"))).isTrue();
        assertThat(ExpressionSyntax.normalize("a == 'x and y' and b")).isEqualTo("a == 'x and y' && b");
    }

    @Test
    void evaluatesValuesAndNulls() {
        Map<String, Object> vars = new HashMap<>();
        vars.put("maybe", null);
        vars.put("n", 2);
        assertThat(WorkflowExpressions.compile("n * 21").evaluate(vars)).isEqualTo(42L);
        assertThat(WorkflowExpressions.compile("maybe == null").evaluate(vars)).isEqualTo(true);
    }

    @Test
    void aMissingVariableFailsLoudlyInsteadOfBecomingFalse() {
        assertThatThrownBy(() -> test("${lead_priority == 'HIGH'}", Map.of()))
                .isInstanceOf(ExpressionEvaluationException.class)
                .hasMessageContaining(ExpressionEvaluationException.CODE)
                .hasMessageContaining("lead_priority");
    }

    @Test
    void aMissingMapKeyFailsLoudly() {
        assertThatThrownBy(() -> test("applicant.missing > 1", Map.of("applicant", Map.of("x", 1))))
                .isInstanceOf(ExpressionEvaluationException.class)
                .hasMessageContaining("missing");
    }

    @Test
    void aNonBooleanConditionFailsLoudly() {
        assertThatThrownBy(() -> test("score + 1", Map.of("score", 1)))
                .isInstanceOf(ExpressionEvaluationException.class)
                .hasMessageContaining("boolean");
    }

    @Test
    void errorMessagesNeverContainVariableValues() {
        assertThatThrownBy(() -> test("secret > 5", Map.of("secret", "TOP-SECRET-VALUE")))
                .isInstanceOf(ExpressionEvaluationException.class)
                .satisfies(error -> assertThat(error.getMessage()).doesNotContain("TOP-SECRET-VALUE"));
    }

    @Test
    void invalidSyntaxIsACompileError() {
        assertThatThrownBy(() -> WorkflowExpressions.compile("score >>> 3"))
                .isInstanceOf(ExpressionCompileException.class);
        assertThatThrownBy(() -> WorkflowExpressions.compile("  "))
                .isInstanceOf(ExpressionCompileException.class);
        assertThatThrownBy(() -> WorkflowExpressions.compile("x == " + "1 + ".repeat(2_000) + "1"))
                .isInstanceOf(ExpressionCompileException.class);
    }
}
