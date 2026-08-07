package com.abada.engine.util;


import java.util.Map;

public final class ConditionEvaluator {

    // Evaluate a condition against variables. Returns false on any error.
    public static boolean evaluate(String rawExpr, Map<String, Object> vars) {
        if (rawExpr == null || rawExpr.isBlank()) return false;

        String expr = normalizeExpression(rawExpr);

        // Optional: simple operator aliases often seen in EL
        expr = expr.replaceAll("\\band\\b", "&&")
                .replaceAll("\\bor\\b", "||")
                .replaceAll("\\beq\\b", "==")
                .replaceAll("\\bne\\b", "!=");

        try {
            Object result = evaluateValue(expr, vars);
            if (result instanceof Boolean) return (Boolean) result;
            if (result == null) return false;
            // Best‑effort coercion (e.g., number/string truthiness)
            if (result instanceof Number) return ((Number) result).doubleValue() != 0d;
            return Boolean.parseBoolean(String.valueOf(result));
        } catch (Exception ex) {
            return false;
        }
    }

    /**
     * Evaluates an expression against variables and returns its raw value
     * (Boolean, Number or String), or null when it cannot be evaluated.
     * Accepts plain variable names, deep paths ({@code data.score}) and
     * Camunda/EL expressions ({@code ${data.score}}).
     */
    public static Object evaluateValue(String rawExpr, Map<String, Object> vars) {
        if (rawExpr == null || rawExpr.isBlank()) return null;
        String expr = normalizeExpression(rawExpr);

        // Create a fresh engine per call (Nashorn engine objects are not threadsafe)
        javax.script.ScriptEngine engine =
                new javax.script.ScriptEngineManager().getEngineByName("JavaScript");
        if (engine == null) return null;

        // Bind variables (Boolean, Number, String map cleanly into Nashorn)
        if (vars != null) {
            for (var e : vars.entrySet()) {
                engine.put(e.getKey(), e.getValue());
            }
        }

        try {
            return engine.eval(expr);
        } catch (Exception ex) {
            // Fall back to a plain or dotted path lookup for engines that do not
            // expose bound Java Maps as JS properties.
            return lookupPath(expr, vars);
        }
    }

    private static String normalizeExpression(String rawExpr) {
        String expr = rawExpr.trim();
        // Remove wrapping <![CDATA[ ... ]]> if present
        expr = expr.replaceAll("^<!\\[CDATA\\[|\\]\\]>$", "").trim();
        // If it's ${...}, extract the inside
        var m = java.util.regex.Pattern.compile("^\\$\\{(.*)}$").matcher(expr);
        if (m.find()) {
            expr = m.group(1).trim();
        }
        return expr;
    }

    private static Object lookupPath(String path, Map<String, Object> vars) {
        if (vars == null) return null;
        String[] parts = path.split("\\.");
        Object current = vars.get(parts[0]);
        for (int i = 1; i < parts.length && current != null; i++) {
            if (current instanceof Map<?, ?> map) {
                current = map.get(parts[i]);
            } else {
                return null;
            }
        }
        return current;
    }

    private ConditionEvaluator() {}
}
