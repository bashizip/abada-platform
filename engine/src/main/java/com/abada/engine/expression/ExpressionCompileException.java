package com.abada.engine.expression;

/** An authored expression is not valid CEL; raised at deployment or first compilation. */
public final class ExpressionCompileException extends IllegalArgumentException {
    private final String expression;

    public ExpressionCompileException(String expression, String reason) {
        super("Invalid expression '" + abbreviate(expression) + "': " + reason);
        this.expression = expression;
    }

    public String getExpression() { return expression; }

    static String abbreviate(String value) {
        if (value == null) return "";
        String flat = value.strip().replaceAll("\\s+", " ");
        return flat.length() > 200 ? flat.substring(0, 200) + "…" : flat;
    }
}
