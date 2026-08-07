package com.abada.engine.util;

import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.DecisionTableMeta;
import com.abada.engine.core.model.DecisionTableMeta.DecisionTableInput;
import com.abada.engine.core.model.DecisionTableMeta.DecisionTableRule;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DecisionTableEvaluatorTest {

    private static final DecisionTableInput SCORE = new DecisionTableInput("score", "${data.score}");
    private static final DecisionTableInput INCOME = new DecisionTableInput("income", "${data.income}");

    private static DecisionTableMeta table(String hitPolicy, List<DecisionTableRule> rules) {
        return new DecisionTableMeta("dt-1", "Decision", "DT_1", hitPolicy,
                List.of(SCORE, INCOME), rules);
    }

    @Test
    @DisplayName("FIRST selects the first matching rule and applies its outputs")
    void firstSelectsFirstMatch() {
        var rules = List.of(
                new DecisionTableRule("score >= 750 and income >= 60000", false,
                        Map.of("riskLevel", "LOW", "autoApprove", true)),
                new DecisionTableRule("score >= 600", false, Map.of("riskLevel", "MEDIUM")),
                new DecisionTableRule(null, true, Map.of("riskLevel", "HIGH")));
        var result = DecisionTableEvaluator.evaluate(table("FIRST", rules),
                Map.of("data", Map.of("score", 780, "income", 85000)));

        assertThat(result.matchedRuleIndexes()).containsExactly(0);
        assertThat(result.outputs()).containsEntry("riskLevel", "LOW").containsEntry("autoApprove", true);
        assertThat(result.inputs()).containsEntry("score", 780).containsEntry("income", 85000);
    }

    @Test
    @DisplayName("FIRST falls back to the otherwise rule when nothing matches")
    void firstFallsBackToOtherwise() {
        var rules = List.of(
                new DecisionTableRule("score >= 750 and income >= 60000", false, Map.of("riskLevel", "LOW")),
                new DecisionTableRule(null, true, Map.of("riskLevel", "HIGH", "autoApprove", false)));
        var result = DecisionTableEvaluator.evaluate(table("FIRST", rules),
                Map.of("data", Map.of("score", 500, "income", 30000)));

        assertThat(result.matchedRuleIndexes()).containsExactly(1);
        assertThat(result.outputs()).containsEntry("riskLevel", "HIGH").containsEntry("autoApprove", false);
    }

    @Test
    @DisplayName("UNIQUE rejects ambiguous matches")
    void uniqueRejectsMultipleMatches() {
        var rules = List.of(
                new DecisionTableRule("score >= 600", false, Map.of("level", "A")),
                new DecisionTableRule("income >= 40000", false, Map.of("level", "B")));
        assertThatThrownBy(() -> DecisionTableEvaluator.evaluate(table("UNIQUE", rules),
                Map.of("data", Map.of("score", 700, "income", 50000))))
                .isInstanceOf(ProcessEngineException.class)
                .hasMessageContaining("UNIQUE hit policy");
    }

    @Test
    @DisplayName("COLLECT merges the outputs of every matching rule")
    void collectMergesAllMatches() {
        var rules = List.of(
                new DecisionTableRule("score >= 600", false, Map.of("eligible", true)),
                new DecisionTableRule("income >= 40000", false, Map.of("premium", true)),
                new DecisionTableRule(null, true, Map.of("riskLevel", "HIGH")));
        var result = DecisionTableEvaluator.evaluate(table("COLLECT", rules),
                Map.of("data", Map.of("score", 700, "income", 50000)));

        assertThat(result.matchedRuleIndexes()).containsExactly(0, 1);
        assertThat(result.outputs()).containsEntry("eligible", true).containsEntry("premium", true);
    }

    @Test
    @DisplayName("No matching rule and no otherwise rule fails loudly")
    void noMatchWithoutOtherwiseFails() {
        var rules = List.of(
                new DecisionTableRule("score >= 900", false, Map.of("approved", true)));
        assertThatThrownBy(() -> DecisionTableEvaluator.evaluate(table("FIRST", rules),
                Map.of("data", Map.of("score", 100))))
                .isInstanceOf(ProcessEngineException.class)
                .hasMessageContaining("matched no rule");
    }

    @Test
    @DisplayName("Inputs resolve from plain names, EL expressions and deep paths")
    void resolvesInputsFromVariables() {
        var meta = new DecisionTableMeta("dt-2", "Decision", "DT_2", "FIRST",
                List.of(
                        new DecisionTableInput("plain", null),
                        new DecisionTableInput("el", "${data.score}"),
                        new DecisionTableInput("path", "data.income")),
                List.of(new DecisionTableRule("plain > 0", false, Map.of("ok", true))));
        var result = DecisionTableEvaluator.evaluate(meta,
                Map.of("plain", 5, "data", Map.of("score", 7, "income", 9)));

        assertThat(result.inputs()).containsEntry("plain", 5).containsEntry("el", 7).containsEntry("path", 9);
    }

    @Test
    @DisplayName("Condition aliases (and/or) evaluate deterministically")
    void conditionAliasesEvaluate() {
        var rules = List.of(
                new DecisionTableRule("score >= 750 and income >= 60000", false, Map.of("tier", "GOLD")),
                new DecisionTableRule(null, true, Map.of("tier", "STANDARD")));
        var gold = DecisionTableEvaluator.evaluate(table("FIRST", rules),
                Map.of("data", Map.of("score", 800, "income", 70000)));
        var standard = DecisionTableEvaluator.evaluate(table("FIRST", rules),
                Map.of("data", Map.of("score", 800, "income", 20000)));

        assertThat(gold.outputs()).containsEntry("tier", "GOLD");
        assertThat(standard.outputs()).containsEntry("tier", "STANDARD");
    }
}
