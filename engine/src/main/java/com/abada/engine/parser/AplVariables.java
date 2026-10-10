package com.abada.engine.parser;

import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.DecisionTableMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.core.model.SequenceFlow;
import com.abada.engine.core.model.ServiceTaskMeta;
import com.abada.engine.expression.ExpressionCompileException;
import com.abada.engine.expression.WorkflowExpressions;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Typed variable declarations ({@code metadata.variables}) and the static
 * unknown-identifier check.
 *
 * <p>When a document declares {@code metadata.variables}, every top-level
 * identifier an expression reads must be declared there or written by an
 * upstream node (an agent's {@code result_variable} and outcome variables, an
 * engine-task's outcome variables, decision-table outputs) or be
 * {@code correlationKey}. Unresolved identifiers are warnings
 * ({@link #VARIABLE_CODE}); without declarations the check is skipped, because
 * the start payload is unknown.
 *
 * <p>Decision-table {@code when} rules only see the table's inputs, so an
 * identifier that is not an input is reported whether or not variables are
 * declared. Messages name identifiers and nodes, never values.
 */
final class AplVariables {
    static final String VARIABLE_CODE = "ABADA-APL-VARIABLE-001";
    private static final String ERROR_CODE = "ABADA-APL-VALIDATION-001";
    private static final Pattern NAME = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final Set<String> TYPES = Set.of("string", "number", "integer", "boolean", "object", "list", "any");
    private static final String CORRELATION_KEY = "correlationKey";

    private AplVariables() {}

    /** Errors in the declarations themselves: invalid or duplicate names, unknown types. */
    static List<BpmnValidationIssue> declarationErrors(JsonNode root) {
        List<BpmnValidationIssue> errors = new ArrayList<>();
        JsonNode variables = root.path("metadata").path("variables");
        if (variables.isMissingNode() || variables.isNull()) return errors;
        if (!variables.isArray()) {
            errors.add(error("/metadata/variables", "metadata.variables must be a list of {name, type}"));
            return errors;
        }
        Set<String> names = new HashSet<>();
        for (int index = 0; index < variables.size(); index++) {
            JsonNode variable = variables.get(index);
            String pointer = "/metadata/variables/" + index;
            String name = variable.path("name").asText(null);
            if (name == null || !NAME.matcher(name).matches()) {
                errors.add(error(pointer + "/name",
                        "metadata.variables[" + index + "].name must match [A-Za-z_][A-Za-z0-9_]*"));
            } else if (!names.add(name)) {
                errors.add(error(pointer + "/name", "metadata.variables declares '" + name + "' more than once"));
            }
            if (variable.has("sensitive") && !variable.path("sensitive").isBoolean()) {
                errors.add(error(pointer + "/sensitive", "metadata.variables[" + index + "].sensitive must be true or false"));
            }
            JsonNode type = variable.path("type");
            if (!type.isMissingNode() && !TYPES.contains(type.asText())) {
                errors.add(error(pointer + "/type", "metadata.variables[" + index + "].type must be one of "
                        + String.join(", ", TYPES.stream().sorted().toList())));
            }
        }
        return errors;
    }

    /** Variables declared {@code sensitive: true}: masked in redacted agent evidence. */
    static Set<String> sensitiveNames(JsonNode root) {
        Set<String> names = new LinkedHashSet<>();
        root.path("metadata").path("variables").forEach(variable -> {
            if (variable.path("name").isTextual() && variable.path("sensitive").asBoolean(false)) {
                names.add(variable.path("name").asText());
            }
        });
        return names;
    }

    static Set<String> declaredNames(JsonNode root) {
        Set<String> names = new LinkedHashSet<>();
        root.path("metadata").path("variables").forEach(variable -> {
            if (variable.path("name").isTextual()) names.add(variable.path("name").asText());
        });
        return names;
    }

    static List<BpmnValidationIssue> analyze(JsonNode root, ParsedProcessDefinition definition,
            Map<String, String> pointerById) {
        List<BpmnValidationIssue> warnings = new ArrayList<>();
        Map<String, JsonNode> nodes = new HashMap<>();
        root.path("flow").path("nodes").forEach(node -> nodes.put(node.path("id").asText(), node));

        checkDecisionRules(definition, pointerById, warnings);

        JsonNode declarations = root.path("metadata").path("variables");
        if (!declarations.isArray()) return warnings;
        Set<String> declared = declaredNames(root);
        declared.add(CORRELATION_KEY);

        Map<String, List<String>> predecessors = new HashMap<>();
        for (SequenceFlow flow : definition.getSequenceFlows()) {
            predecessors.computeIfAbsent(flow.getTargetRef(), key -> new ArrayList<>()).add(flow.getSourceRef());
        }
        Set<String> reported = new HashSet<>();

        for (SequenceFlow flow : definition.getSequenceFlows()) {
            String condition = flow.getConditionExpression();
            // Synthetic outcome gateways only read engine-written variables.
            if (condition == null || condition.isBlank()
                    || flow.getSourceRef().endsWith(AplParser.OUTCOME_GATEWAY_SUFFIX)) continue;
            check(flow.getSourceRef(), identifiers(condition), "condition", declared, nodes, predecessors,
                    pointerById, reported, warnings);
        }
        for (DecisionTableMeta table : definition.getDecisionTables().values()) {
            for (DecisionTableMeta.DecisionTableInput input : table.inputs()) {
                Set<String> reads = input.expr() == null || input.expr().isBlank()
                        ? Set.of(input.name()) : identifiers(input.expr());
                check(table.id(), reads, "input '" + input.name() + "'", declared, nodes, predecessors,
                        pointerById, reported, warnings);
            }
        }
        for (ServiceTaskMeta task : definition.getServiceTasks().values()) {
            if (task.agentWork() == null) continue;
            task.agentWork().inputs().forEach((name, expression) -> {
                if (expression != null && !expression.isBlank()) {
                    check(task.id(), identifiers(expression), "input '" + name + "'", declared, nodes,
                            predecessors, pointerById, reported, warnings);
                }
            });
        }
        definition.getAllAgentRoutes().forEach((nodeId, routes) -> {
            // A route's when reads the agent's own result besides what earlier steps wrote.
            String result = nodes.containsKey(nodeId)
                    ? nodes.get(nodeId).path("result_variable").asText(nodeId + "_result") : nodeId + "_result";
            for (var route : routes) {
                if (route.when() == null || route.when().isBlank()) continue;
                Set<String> reads = new HashSet<>(identifiers(route.when()));
                reads.remove(result);
                check(nodeId, reads, "route '" + route.name() + "' when", declared, nodes, predecessors,
                        pointerById, reported, warnings);
            }
        });
        return warnings;
    }

    private static void checkDecisionRules(ParsedProcessDefinition definition, Map<String, String> pointerById,
            List<BpmnValidationIssue> warnings) {
        for (DecisionTableMeta table : definition.getDecisionTables().values()) {
            Set<String> inputs = new HashSet<>();
            table.inputs().forEach(input -> inputs.add(input.name()));
            for (int index = 0; index < table.rules().size(); index++) {
                DecisionTableMeta.DecisionTableRule rule = table.rules().get(index);
                if (rule.otherwise() || rule.when() == null) continue;
                for (String identifier : identifiers(rule.when())) {
                    if (inputs.contains(identifier)) continue;
                    warnings.add(warning(pointerById.get(table.id()) + "/rules/" + index + "/when", table.id(),
                            "decision-table '" + table.id() + "' rule " + index + " reads '" + identifier
                                    + "', which is not one of the table inputs",
                            "A 'when' rule only sees the table's declared inputs; add '" + identifier
                                    + "' to 'inputs' or fix the name."));
                }
            }
        }
    }

    private static void check(String owner, Set<String> reads, String context, Set<String> declared,
            Map<String, JsonNode> nodes, Map<String, List<String>> predecessors, Map<String, String> pointerById,
            Set<String> reported, List<BpmnValidationIssue> warnings) {
        if (reads.isEmpty()) return;
        Set<String> available = new HashSet<>(declared);
        for (String ancestor : ancestors(owner, predecessors)) {
            available.addAll(writtenBy(ancestor, nodes.get(ancestor)));
        }
        String nodeId = owner.replaceAll("_e\\d+$", "");
        for (String identifier : reads) {
            if (available.contains(identifier) || !reported.add(owner + "|" + identifier)) continue;
            warnings.add(warning(pointerById.get(nodeId), nodeId,
                    "node '" + nodeId + "' " + context + " reads '" + identifier
                            + "', which is neither declared in metadata.variables nor written by an upstream node",
                    "Declare '" + identifier + "' in metadata.variables (start payload, or a variable written by "
                            + "an engine-task, script or human-input node), or fix the name."));
        }
    }

    /** Variables a node writes when it completes, as the runtime names them. */
    private static Set<String> writtenBy(String nodeId, JsonNode node) {
        if (node == null) return Set.of();
        Set<String> written = new HashSet<>();
        switch (node.path("type").asText()) {
            case "agent" -> {
                written.add(node.path("result_variable").asText(nodeId + "_result"));
                written.add(AplParser.outcomeVariable(nodeId));
                written.add(AplParser.errorCodeVariable(nodeId));
                written.add(AplParser.rawOutputVariable(nodeId));
                if (node.path("routes").isObject()) written.add(AplParser.routeVariable(nodeId));
            }
            case "engine-task" -> {
                // Written when a boundary (on_error, on_timeout) is declared and fires.
                written.add(AplParser.outcomeVariable(nodeId));
                written.add(AplParser.errorCodeVariable(nodeId));
            }
            case "human-input", "approval-gate" -> {
                // The reviewer's decision and comment, or a boundary (on_error, on_timeout) that fired.
                written.add(AplParser.outcomeVariable(nodeId));
                written.add(AplParser.errorCodeVariable(nodeId));
                written.add(AplParser.commentVariable(nodeId));
            }
            case "call-process" -> {
                // The mapped outputs on completion, or a boundary (on_error, on_timeout) that fired.
                node.path("outputs").fieldNames().forEachRemaining(written::add);
                written.add(AplParser.outcomeVariable(nodeId));
                written.add(AplParser.errorCodeVariable(nodeId));
            }
                        case "decision-table" -> node.path("rules").forEach(rule -> {
                rule.path("then").fieldNames().forEachRemaining(written::add);
                rule.path("otherwise").path("then").fieldNames().forEachRemaining(written::add);
            });
            default -> { }
        }
        return written;
    }

    private static Set<String> ancestors(String nodeId, Map<String, List<String>> predecessors) {
        Set<String> seen = new HashSet<>();
        Deque<String> pending = new ArrayDeque<>(predecessors.getOrDefault(nodeId, List.of()));
        while (!pending.isEmpty()) {
            String current = pending.pop();
            if (seen.add(current)) pending.addAll(predecessors.getOrDefault(current, List.of()));
        }
        return seen;
    }

    private static Set<String> identifiers(String expression) {
        try {
            return WorkflowExpressions.compile(expression).identifiers();
        } catch (ExpressionCompileException exception) {
            return Set.of(); // reported by DefinitionPolicyValidator
        }
    }

    private static BpmnValidationIssue error(String path, String message) {
        return new BpmnValidationIssue(ERROR_CODE, ValidationSeverity.ERROR, message, null, null,
                AplParser.LANGUAGE_VERSION, null, null, path);
    }

    private static BpmnValidationIssue warning(String path, String elementId, String message, String resolution) {
        return new BpmnValidationIssue(VARIABLE_CODE, ValidationSeverity.WARNING, message, null, elementId,
                AplParser.LANGUAGE_VERSION, null, resolution, path);
    }
}
