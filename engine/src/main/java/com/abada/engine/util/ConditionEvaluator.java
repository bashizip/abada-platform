package com.abada.engine.util;

import com.abada.engine.expression.WorkflowExpressions;
import java.util.Map;

/**
 * Facade over {@link WorkflowExpressions} for gateway conditions and
 * decision-table rules. Expressions are CEL; an expression that cannot be
 * evaluated raises {@link com.abada.engine.expression.ExpressionEvaluationException}
 * instead of silently returning {@code false}.
 */
public final class ConditionEvaluator {

    private ConditionEvaluator() {}

    /** A blank condition is "no condition" and evaluates to false; anything else must be a boolean CEL expression. */
    public static boolean evaluate(String rawExpr, Map<String, Object> vars) {
        if (rawExpr == null || rawExpr.isBlank()) return false;
        return WorkflowExpressions.compile(rawExpr).test(vars);
    }

    /** Evaluates an expression and returns its value (Boolean, Long, Double, String, Map, List or null). */
    public static Object evaluateValue(String rawExpr, Map<String, Object> vars) {
        if (rawExpr == null || rawExpr.isBlank()) return null;
        return WorkflowExpressions.compile(rawExpr).evaluate(vars);
    }
}
