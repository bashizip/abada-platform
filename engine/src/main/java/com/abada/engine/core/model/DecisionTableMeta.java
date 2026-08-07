package com.abada.engine.core.model;

import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * Canonical metadata of a deterministic decision table declared with the native
 * {@code abada:decisionTable} extension on a {@code bpmn:businessRuleTask}.
 *
 * <p>The engine executes the table inline, inside the workflow transaction, so
 * a decision is never delegated to a probabilistic model: the table is the
 * "law", agents are the "advice".
 *
 * @param id         Business rule task id.
 * @param name       Business rule task name.
 * @param decisionKey Stable audit key identifying the table (defaults to the task id).
 * @param hitPolicy  FIRST, UNIQUE or COLLECT.
 * @param inputs     Input declarations (name + optional variable expression).
 * @param rules      Ordered rules; conditions are evaluated against resolved inputs.
 */
public record DecisionTableMeta(
        String id,
        String name,
        String decisionKey,
        String hitPolicy,
        List<DecisionTableInput> inputs,
        List<DecisionTableRule> rules) implements Serializable {

    public record DecisionTableInput(String name, String expr) implements Serializable {
    }

    public record DecisionTableRule(String when, boolean otherwise, Map<String, Object> then)
            implements Serializable {
    }
}
