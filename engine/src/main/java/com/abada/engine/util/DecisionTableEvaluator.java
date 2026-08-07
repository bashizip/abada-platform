package com.abada.engine.util;

import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.DecisionTableMeta;
import com.abada.engine.core.model.DecisionTableMeta.DecisionTableInput;
import com.abada.engine.core.model.DecisionTableMeta.DecisionTableRule;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Deterministic decision-table evaluation. This is the engine-side "law": the
 * evaluation never invokes a probabilistic model, so a critical decision is
 * fully reproducible and auditable from the deployed table.
 *
 * <p>Rules are evaluated in model order against the resolved inputs. Without a
 * matching rule the {@code otherwise} rule applies; when neither exists the
 * execution fails loudly instead of guessing.
 */
public final class DecisionTableEvaluator {

    public record Result(Map<String, Object> inputs, List<Integer> matchedRuleIndexes,
            Map<String, Object> outputs) {
    }

    public static Result evaluate(DecisionTableMeta table, Map<String, Object> variables) {
        Map<String, Object> inputs = new LinkedHashMap<>();
        for (DecisionTableInput input : table.inputs()) {
            inputs.put(input.name(), resolveInput(input, variables));
        }

        List<Integer> matched = new ArrayList<>();
        for (int i = 0; i < table.rules().size(); i++) {
            DecisionTableRule rule = table.rules().get(i);
            if (rule.otherwise()) continue;
            if (ConditionEvaluator.evaluate(rule.when(), inputs)) matched.add(i);
        }

        int otherwiseIndex = -1;
        for (int i = 0; i < table.rules().size(); i++) {
            if (table.rules().get(i).otherwise()) otherwiseIndex = i;
        }

        List<Integer> selected = new ArrayList<>();
        String hitPolicy = table.hitPolicy() == null ? "FIRST" : table.hitPolicy().toUpperCase(java.util.Locale.ROOT);
        switch (hitPolicy) {
            case "UNIQUE" -> {
                if (matched.size() > 1) {
                    throw new ProcessEngineException("Decision table '" + table.decisionKey()
                            + "' matched " + matched.size() + " rules under UNIQUE hit policy");
                }
                if (matched.size() == 1) selected.add(matched.get(0));
            }
            case "COLLECT" -> selected.addAll(matched);
            default -> { // FIRST
                if (!matched.isEmpty()) selected.add(matched.get(0));
            }
        }

        if (selected.isEmpty() && otherwiseIndex >= 0) {
            selected.add(otherwiseIndex);
        }
        if (selected.isEmpty()) {
            throw new ProcessEngineException("Decision table '" + table.decisionKey()
                    + "' matched no rule and declares no otherwise rule");
        }

        Map<String, Object> outputs = new LinkedHashMap<>();
        for (int index : selected) {
            outputs.putAll(table.rules().get(index).then());
        }
        return new Result(inputs, List.copyOf(selected), Map.copyOf(outputs));
    }

    private static Object resolveInput(DecisionTableInput input, Map<String, Object> variables) {
        if (input.expr() == null || input.expr().isBlank()) {
            return variables.get(input.name());
        }
        return ConditionEvaluator.evaluateValue(input.expr(), variables);
    }

    private DecisionTableEvaluator() {
    }
}
