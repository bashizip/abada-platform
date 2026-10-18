package com.abada.engine.parser;

import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.DecisionTableMeta;
import com.abada.engine.core.model.DecisionTableMeta.DecisionTableInput;
import com.abada.engine.core.model.DecisionTableMeta.DecisionTableRule;
import com.abada.engine.expression.ExpressionCompileException;
import com.abada.engine.expression.ExpressionSyntax;
import com.abada.engine.expression.WorkflowExpressions;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

/**
 * Deployment rules for one decision table, each pinned to the rule it is about
 * ({@code rules/<index>}, relative to the node). They catch at deployment what
 * would otherwise fail, or be silently ignored, when the table runs:
 *
 * <ul>
 *   <li>an empty {@code when} on a rule that is not the fallback;</li>
 *   <li>a {@code when} that is not valid CEL;</li>
 *   <li>a {@code when} reading a name that is not a declared input: conditions
 *       see only the table's inputs, so that name never has a value and the
 *       rule fails whenever its result depends on it;</li>
 *   <li>more than one {@code otherwise} rule (only the last one would apply);</li>
 *   <li>under {@code UNIQUE}, two rules with the same condition (they always
 *       match together). Overlaps between different conditions cannot be
 *       decided statically and stay a run-time failure.</li>
 * </ul>
 *
 * Checked on deployment and authoring only, so stored definitions still load.
 */
public final class DecisionTableRules {
    private DecisionTableRules() {}

    /** Issues for {@code table}; each path is relative to its node, e.g. {@code rules/2/when}. */
    public static List<BpmnValidationIssue> check(DecisionTableMeta table, String code, String namespace,
            String processId) {
        List<BpmnValidationIssue> issues = new ArrayList<>();
        Set<String> inputs = table.inputs().stream().map(DecisionTableInput::name)
                .collect(Collectors.toCollection(TreeSet::new));
        Map<String, Integer> conditions = new HashMap<>();
        int otherwiseAt = -1;
        List<DecisionTableRule> rules = table.rules();
        for (int index = 0; index < rules.size(); index++) {
            DecisionTableRule rule = rules.get(index);
            int number = index + 1;
            if (rule.otherwise()) {
                if (otherwiseAt >= 0) {
                    issues.add(issue(code, namespace, processId, table, "rules/" + index,
                            "decision table '" + table.id() + "' declares a second otherwise rule (rule " + number
                                    + "; rule " + (otherwiseAt + 1) + " is already the fallback)",
                            "Keep one otherwise rule; give the other a 'when' condition or remove it."));
                } else {
                    otherwiseAt = index;
                }
                continue;
            }
            String path = "rules/" + index + "/when";
            if (rule.when() == null) {
                issues.add(issue(code, namespace, processId, table, path,
                        "decision table '" + table.id() + "' rule " + number + " has an empty condition",
                        "Write the condition under which the rule applies, or make it the otherwise rule."));
                continue;
            }
            Set<String> read;
            try {
                read = WorkflowExpressions.compile(rule.when()).identifiers();
            } catch (ExpressionCompileException exception) {
                issues.add(issue(code, namespace, processId, table, path,
                        "decision table '" + table.id() + "' rule " + number + ": " + exception.getMessage(),
                        "Conditions use CEL over the table's inputs: comparisons, &&, ||, !, arithmetic, "
                                + "'strings', has(a.b)."));
                continue;
            }
            Set<String> unknown = new TreeSet<>(read);
            unknown.removeAll(inputs);
            if (!unknown.isEmpty()) {
                issues.add(issue(code, namespace, processId, table, path,
                        "decision table '" + table.id() + "' rule " + number + " reads "
                                + String.join(", ", unknown) + ", which "
                                + (unknown.size() == 1 ? "is not a declared input" : "are not declared inputs")
                                + (inputs.isEmpty() ? " (the table declares none)" : " (inputs: "
                                + String.join(", ", inputs) + ")"),
                        "Conditions see only the table's inputs. Declare an input for each name the rule "
                                + "reads, e.g. inputs: [{ name: score, expr: '${applicant.score}' }]."));
                continue;
            }
            if ("UNIQUE".equals(table.hitPolicy())) {
                String condition = ExpressionSyntax.normalize(rule.when()).strip().replaceAll("\\s+", " ");
                Integer first = conditions.putIfAbsent(condition, index);
                if (first != null) {
                    issues.add(issue(code, namespace, processId, table, path,
                            "decision table '" + table.id() + "' rule " + number + " has the same condition as rule "
                                    + (first + 1) + "; under UNIQUE both always match and the table fails",
                            "Make the conditions exclusive, merge the two rules, or use the FIRST hit policy."));
                }
            }
        }
        return issues;
    }

    private static BpmnValidationIssue issue(String code, String namespace, String processId,
            DecisionTableMeta table, String path, String message, String resolution) {
        return new BpmnValidationIssue(code, ValidationSeverity.ERROR, message, processId, table.id(), namespace,
                null, resolution, path);
    }
}
