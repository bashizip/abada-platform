package com.abada.engine.expression;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.DecisionTableMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.core.model.SequenceFlow;
import com.abada.engine.core.model.ServiceTaskMeta;
import java.util.ArrayList;
import java.util.List;

/**
 * Deployment-time gate for executable content: every expression must compile
 * as CEL, script tasks require the operator opt-in, and Java delegates must be
 * on the operator allow-list. Runs on deployment and authoring validation
 * only; reloading an already-deployed definition never re-applies it, so a
 * tightened policy cannot change the semantics of running instances.
 */
public final class DefinitionPolicyValidator {
    private DefinitionPolicyValidator() {}

    public static void validate(ParsedProcessDefinition definition, String errorCode, String namespace) {
        List<BpmnValidationIssue> issues = new ArrayList<>();
        String processId = definition.getId();
        for (SequenceFlow flow : definition.getSequenceFlows()) {
            String condition = flow.getConditionExpression();
            if (condition != null && !condition.isBlank()) {
                compile(condition, processId, flow.getSourceRef(), errorCode, namespace, issues);
            }
        }
        for (DecisionTableMeta table : definition.getDecisionTables().values()) {
            for (DecisionTableMeta.DecisionTableInput input : table.inputs()) {
                if (input.expr() != null && !input.expr().isBlank()) {
                    compile(input.expr(), processId, table.id(), errorCode, namespace, issues);
                }
            }
            for (DecisionTableMeta.DecisionTableRule rule : table.rules()) {
                if (!rule.otherwise() && rule.when() != null && !rule.when().isBlank()) {
                    compile(rule.when(), processId, table.id(), errorCode, namespace, issues);
                }
            }
        }
        if (!ExecutionPolicy.scriptsEnabled()) {
            definition.getScriptTasks().keySet().forEach(taskId -> issues.add(issue(errorCode, namespace,
                    processId, taskId, "script task '" + taskId + "' is not allowed: script tasks are disabled",
                    "Replace the script with a decision table or an engine-task worker, or have the operator set "
                            + ExecutionPolicy.SCRIPTS_ENABLED + "=true (ABADA_SCRIPTS_ENABLED).")));
        }
        for (ServiceTaskMeta task : definition.getServiceTasks().values()) {
            if (task.agentWork() != null) {
                task.agentWork().inputs().forEach((name, expression) -> {
                    if (expression != null && !expression.isBlank()) {
                        compile(expression, processId, task.id(), errorCode, namespace, issues);
                    }
                });
            }
        }
        for (ServiceTaskMeta task : definition.getServiceTasks().values()) {
            if (task.className() != null && !task.className().isBlank()
                    && !ExecutionPolicy.delegateAllowed(task.className())) {
                issues.add(issue(errorCode, namespace, processId, task.id(),
                        "Java delegate '" + task.className() + "' is not on the operator allow-list",
                        "Use an external task topic, or have the operator add the class to "
                                + ExecutionPolicy.ALLOWED_DELEGATES + " (ABADA_DELEGATES_ALLOWED_CLASSES)."));
            }
        }
        if (!issues.isEmpty()) throw new BpmnValidationException(issues);
    }

    private static void compile(String expression, String processId, String elementId, String errorCode,
            String namespace, List<BpmnValidationIssue> issues) {
        try {
            WorkflowExpressions.compile(expression);
        } catch (ExpressionCompileException exception) {
            issues.add(issue(errorCode, namespace, processId, elementId,
                    "node '" + elementId + "': " + exception.getMessage(),
                    "Expressions use CEL: comparisons, &&, ||, !, arithmetic, 'strings', has(a.b), "
                            + "list.exists(x, ...). JavaScript and Java calls are not supported."));
        }
    }

    private static BpmnValidationIssue issue(String code, String namespace, String processId, String elementId,
            String message, String resolution) {
        return new BpmnValidationIssue(code, ValidationSeverity.ERROR, message, processId, elementId, namespace,
                null, resolution);
    }
}
