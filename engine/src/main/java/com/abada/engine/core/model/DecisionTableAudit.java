package com.abada.engine.core.model;

import java.io.Serializable;
import java.util.List;

/**
 * Immutable audit snapshot produced when a decision table is applied during
 * {@code ProcessInstance.advance()}. Only identifiers and names are carried;
 * input/output values never enter history or logs.
 */
public record DecisionTableAudit(
        String activityId,
        String decisionKey,
        List<Integer> matchedRuleIndexes,
        List<String> inputNames,
        List<String> outputNames) implements Serializable {
}
