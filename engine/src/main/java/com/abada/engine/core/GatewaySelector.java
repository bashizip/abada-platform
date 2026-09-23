package com.abada.engine.core;

import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.GatewayMeta;
import com.abada.engine.core.model.SequenceFlow;
import com.abada.engine.util.ConditionEvaluator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Picks the outgoing SequenceFlow for an Exclusive Gateway based on conditions
 * and the gateway's default flow. Designed to be called from the engine's
 * advance loop.
 */
public final class GatewaySelector {
    private static final Logger log = LoggerFactory.getLogger(GatewaySelector.class);

    /**
     * Decide which outgoing flow to take for an EXCLUSIVE gateway.
     *
     * @param gw        Gateway metadata (must provide getId() and getDefaultFlowId()).
     * @param outgoing  All outgoing sequences flow for this gateway, in model order.
     * @param vars      Process instance variables available to condition evaluation.
     * @return          The id of the chosen SequenceFlow.
     */
    public String chooseOutgoing(GatewayMeta gw, List<SequenceFlow> outgoing, Map<String, Object> vars) {
        Objects.requireNonNull(gw, "gw");
        Objects.requireNonNull(outgoing, "outgoing");

        String defaultFlowId = gw.defaultFlowId();
        String chosen = null;

        if (log.isDebugEnabled()) {
            log.debug("Evaluating gateway id={} with {} outgoing flows; vars={}", gw.id(), outgoing.size(), vars);
        }

        for (SequenceFlow f : outgoing) {
            String cond = f.getConditionExpression(); // may be null
            boolean ok = evaluate(gw, cond, vars);
            if (log.isDebugEnabled()) {
                log.debug("  flow id={} cond='{}' -> {}", f.getId(), cond, ok);
            }
            if (ok) {
                chosen = f.getId();
                break; // take the first matching condition
            }
        }

        if (chosen == null) {
            if (defaultFlowId != null) {
                if (log.isDebugEnabled()) {
                    log.debug("  no condition matched; taking default flow {}", defaultFlowId);
                }
                return defaultFlowId;
            }
            throw new ProcessEngineException("No matching condition and no default flow for gateway " + gw.id());
        }
        return chosen;
    }

    /**
     * Decide which outgoing flows to take for an INCLUSIVE gateway.
     *
     * @param gw        Gateway metadata.
     * @param outgoing  All outgoing sequence flows for this gateway.
     * @param vars      Process instance variables for condition evaluation.
     * @return          A list of chosen SequenceFlow IDs.
     */
    private static boolean evaluate(GatewayMeta gw, String condition, Map<String, Object> vars) {
        try {
            return ConditionEvaluator.evaluate(condition, vars);
        } catch (com.abada.engine.expression.ExpressionEvaluationException exception) {
            throw exception.atNode(gw.id());
        }
    }

    public List<String> chooseInclusive(GatewayMeta gw, List<SequenceFlow> outgoing, Map<String, Object> vars) {
        Objects.requireNonNull(gw, "gw");
        Objects.requireNonNull(outgoing, "outgoing");

        String defaultFlowId = gw.defaultFlowId();
        List<String> chosenFlows = new ArrayList<>();

        if (log.isDebugEnabled()) {
            log.debug("Evaluating inclusive gateway id={} with {} outgoing flows; vars={}", gw.id(), outgoing.size(), vars);
        }

        // Evaluate all conditional flows
        for (SequenceFlow f : outgoing) {
            // Skip the default flow for now, it's handled separately
            if (Objects.equals(f.getId(), defaultFlowId)) {
                continue;
            }

            String cond = f.getConditionExpression();
            if (cond != null && !cond.isBlank()) {
                boolean ok = evaluate(gw, cond, vars);
                if (log.isDebugEnabled()) {
                    log.debug("  flow id={} cond='{}' -> {}", f.getId(), cond, ok);
                }
                if (ok) {
                    chosenFlows.add(f.getId());
                }
            }
        }

        // If no conditional flows were taken, take the default flow
        if (chosenFlows.isEmpty()) {
            if (defaultFlowId != null) {
                if (log.isDebugEnabled()) {
                    log.debug("  no conditions matched; taking default flow {}", defaultFlowId);
                }
                chosenFlows.add(defaultFlowId);
            } else {
                // If there's no default flow, it's an error as per the spec
                throw new ProcessEngineException("No matching condition and no default flow for inclusive gateway " + gw.id());
            }
        }

        return chosenFlows;
    }
}
