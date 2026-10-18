package com.abada.engine.core.model;

import java.io.Serializable;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Immutable audit snapshot produced when a decision table is applied during
 * {@code ProcessInstance.advance()}. History receives identifiers and names
 * only; the resolved input values ride along to the engine, which hands them
 * to decision-input evidence under the project's evidence policy. They never
 * enter history or logs, so {@link #toString()} leaves them out.
 */
public record DecisionTableAudit(
        String visitId,
        String activityId,
        String decisionKey,
        List<Integer> matchedRuleIndexes,
        List<String> inputNames,
        List<String> outputNames,
        Map<String, Object> inputs) implements Serializable {

    public DecisionTableAudit {
        // Inputs may resolve to null, so no Map.copyOf.
        inputs = inputs == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(inputs));
    }

    @Override
    public String toString() {
        return "DecisionTableAudit[visitId=" + visitId + ", activityId=" + activityId + ", decisionKey="
                + decisionKey + ", matchedRuleIndexes=" + matchedRuleIndexes + ", inputNames=" + inputNames
                + ", outputNames=" + outputNames + "]";
    }
}
