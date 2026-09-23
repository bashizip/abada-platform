package com.abada.engine.core.agent;

import com.abada.engine.core.model.AgentWorkDescriptor;
import com.abada.engine.expression.ExpressionSyntax;
import com.abada.engine.expression.WorkflowExpressions;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Default-deny data selection for agent tasks: the locked-task payload of an
 * {@code abada:agent} task contains only the node's declared inputs (or the
 * paths its prompt references), resolved by the engine. Everything else stays
 * in the engine.
 */
public final class AgentInputs {
    private static final Logger log = LoggerFactory.getLogger(AgentInputs.class);
    private static final Pattern SIMPLE_PATH = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*");

    private AgentInputs() {}

    public static Map<String, Object> resolve(AgentWorkDescriptor work, Map<String, Object> variables) {
        Map<String, Object> resolved = new LinkedHashMap<>();
        for (Map.Entry<String, String> input : work.inputs().entrySet()) {
            resolved.put(input.getKey(), value(input.getKey(), input.getValue(), variables));
        }
        return resolved;
    }

    private static Object value(String name, String expression, Map<String, Object> variables) {
        String normalized = ExpressionSyntax.normalize(expression == null || expression.isBlank() ? name : expression);
        if (SIMPLE_PATH.matcher(normalized).matches()) {
            Object current = variables;
            for (String segment : normalized.split("\\.")) {
                if (!(current instanceof Map<?, ?> map)) return null;
                current = map.get(segment);
            }
            return current;
        }
        try {
            return WorkflowExpressions.compile(expression).evaluate(variables);
        } catch (RuntimeException exception) {
            log.warn("Agent input '{}' could not be resolved; sending null ({})", name, exception.getClass().getSimpleName());
            return null;
        }
    }
}
