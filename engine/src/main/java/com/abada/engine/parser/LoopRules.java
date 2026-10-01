package com.abada.engine.parser;

import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.LoopMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.core.model.SequenceFlow;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Deployment rules for loops, shared by APL and BPMN: every cycle must be
 * bounded. A cycle's back-edge enters its header, and the header must declare
 * {@code max_iterations} ({@code abada:maxIterations} in BPMN). An
 * {@code on_exhausted} route must leave the loop, otherwise re-entering the
 * header forward would restart the count and the loop would be unbounded.
 */
public final class LoopRules {
    private LoopRules() {}

    public static List<BpmnValidationIssue> check(ParsedProcessDefinition definition, String code, String namespace) {
        List<BpmnValidationIssue> issues = new ArrayList<>();
        Set<String> headers = new LinkedHashSet<>();
        for (String[] edge : definition.getBackEdges()) {
            String header = edge[1];
            if (!headers.add(header) || definition.getLoop(header) != null) continue;
            if (header.equals(definition.getStartEventId())) {
                issues.add(issue(code, ValidationSeverity.ERROR, namespace, definition, header,
                        "cycle back to the start node '" + header + "' (from '" + edge[0] + "'); a loop must "
                                + "return to a step after the start",
                        "Route the cycle back to the first step after the start and declare its loop bound there."));
                continue;
            }
            issues.add(issue(code, ValidationSeverity.ERROR, namespace, definition, header,
                    "cycle back to node '" + header + "' (from '" + edge[0] + "') needs a bound: declare "
                            + "loop.max_iterations on '" + header + "'",
                    "Add `loop: { max_iterations: N }` to the node the cycle returns to (BPMN: "
                            + "abada:maxIterations), optionally with on_exhausted naming where to go when the "
                            + "limit is reached."));
        }
        for (LoopMeta loop : definition.getLoops().values()) {
            if (!headers.contains(loop.headerId())) {
                issues.add(issue(code, ValidationSeverity.WARNING, namespace, definition, loop.headerId(),
                        "node '" + loop.headerId() + "' declares a loop but no flow returns to it; the bound has "
                                + "no effect",
                        "Remove the loop declaration or route the cycle back to this node."));
            }
            if (loop.onExhausted() != null && reaches(definition, loop.onExhausted(), loop.headerId())) {
                issues.add(issue(code, ValidationSeverity.ERROR, namespace, definition, loop.headerId(),
                        "loop on_exhausted target '" + loop.onExhausted() + "' of node '" + loop.headerId()
                                + "' leads back into the loop; it must leave the loop",
                        "Route on_exhausted to a node from which the loop cannot be entered again, such as an "
                                + "escalation step or an end event."));
            }
        }
        return issues;
    }

    private static boolean reaches(ParsedProcessDefinition definition, String from, String target) {
        Deque<String> pending = new ArrayDeque<>(List.of(from));
        Set<String> seen = new HashSet<>();
        while (!pending.isEmpty()) {
            String node = pending.poll();
            if (node.equals(target)) return true;
            if (!seen.add(node)) continue;
            for (SequenceFlow flow : definition.getOutgoing(node)) pending.add(flow.getTargetRef());
        }
        return false;
    }

    private static BpmnValidationIssue issue(String code, ValidationSeverity severity, String namespace,
            ParsedProcessDefinition definition, String elementId, String message, String resolution) {
        return new BpmnValidationIssue(code, severity, message, definition.getId(), elementId, namespace, null,
                resolution);
    }
}
