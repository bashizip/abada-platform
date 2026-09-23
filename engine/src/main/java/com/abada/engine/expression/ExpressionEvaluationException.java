package com.abada.engine.expression;

import com.abada.engine.core.exception.ProcessEngineException;

/**
 * A workflow expression could not be evaluated at runtime (missing variable,
 * type mismatch, non-boolean condition). The surrounding command rolls back;
 * the API reports {@code EXPRESSION_EVALUATION_FAILED}. Messages name the
 * expression and node, never variable values.
 */
public final class ExpressionEvaluationException extends ProcessEngineException {
    public static final String CODE = "ABADA-RUNTIME-EXPRESSION-001";
    private final String expression;
    private final String nodeId;
    private final String reason;

    public ExpressionEvaluationException(String expression, String reason) {
        this(null, expression, reason);
    }

    public ExpressionEvaluationException(String nodeId, String expression, String reason) {
        super(CODE + ": expression '" + ExpressionCompileException.abbreviate(expression) + "'"
                + (nodeId == null ? "" : " at node '" + nodeId + "'") + " could not be evaluated: " + reason);
        this.expression = expression;
        this.nodeId = nodeId;
        this.reason = reason;
    }

    public ExpressionEvaluationException atNode(String node) {
        return nodeId != null ? this : new ExpressionEvaluationException(node, expression, reason);
    }

    public String getExpression() { return expression; }
    public String getNodeId() { return nodeId; }
    public String getReason() { return reason; }
}
