package com.abada.engine.core.replay;

import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.ProcessToken;
import com.abada.engine.core.agent.AgentInputs;
import com.abada.engine.core.agent.AgentOutputValidator;
import com.abada.engine.core.model.AgentRouteMeta;
import com.abada.engine.core.model.AgentWorkDescriptor;
import com.abada.engine.core.model.BoundaryMeta;
import com.abada.engine.core.model.DecisionTableAudit;
import com.abada.engine.core.model.OutcomeMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.core.model.ServiceTaskMeta;
import com.abada.engine.core.model.TaskMeta;
import com.abada.engine.expression.ExpressionEvaluationException;
import com.abada.engine.expression.WorkflowExpressions;
import com.abada.engine.parser.AplParser;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Walks a definition on recorded inputs with the engine's own interpreter ({@link ProcessInstance}), entirely in
 * memory (E15). Nothing is persisted and nothing outside this object is reached: conditions, decision tables,
 * gateways, loops and boundaries run exactly as at runtime, agent steps are answered through an {@link AgentPort}
 * (a model call, outside any transaction) and checked against the same output contract, and human steps are
 * answered from what the original reviewer decided. A step that would need the outside world (an engine task,
 * a timer, a message, a called process) stops the walk and says so.
 */
public final class ReplayRunner {
    public static final int MAX_STEPS = 200;
    /** Stands in for a reviewer's comment, which is never kept; a rework prompt that reads it sees this. */
    public static final String COMMENT_PLACEHOLDER = "[reviewer comment not replayed]";

    /** Boundaries are not steps of their own: they follow from an agent outcome, a route or a human outcome. */
    public enum Kind { AGENT, ROUTE, HUMAN, DECISION }

    /** One decision point of a walk; the same shape is read from the original instance's history. */
    public record Step(String activityId, Kind kind, String outcome) {}

    public enum End { COMPLETED, NEEDS_HUMAN, NEEDS_EXTERNAL, FAILED }

    public record Result(End end, String reason, String stoppedAt, List<Step> path, Double lastConfidence,
            BigDecimal costUsd, boolean costUnpriced, Set<String> toolsSkipped) {}

    /** A model's answer to one agent step, shaped like a worker's completion. */
    public record AgentAnswer(Map<String, Object> variables, String model, Integer promptTokens,
            Integer completionTokens, BigDecimal costUsd, boolean costUnpriced) {}

    /** Runs the agent step once, without tools; any failure is reported by throwing. */
    public interface AgentPort {
        AgentAnswer run(String activityId, AgentWorkDescriptor work, Map<String, Object> inputs) throws Exception;
    }

    /** What the original reviewers decided, handed out in order per human step; empty when there is none left. */
    public interface HumanDecisions {
        Optional<String> next(String activityId);
    }

    public Result run(ParsedProcessDefinition definition, Map<String, Object> inputs, AgentPort agents,
            HumanDecisions humans) {
        ProcessInstance instance = new ProcessInstance(definition);
        instance.putAllVariables(inputs == null ? Map.of() : inputs);
        List<Step> path = new ArrayList<>();
        Set<String> toolsSkipped = new LinkedHashSet<>();
        BigDecimal cost = BigDecimal.ZERO;
        boolean unpriced = false;
        Double confidence = null;

        instance.advance();
        drain(instance, path);
        for (int step = 0; step < MAX_STEPS; step++) {
            if (instance.getStatus() == ProcessStatus.COMPLETED) {
                return done(End.COMPLETED, null, null, path, confidence, cost, unpriced, toolsSkipped);
            }
            if (instance.getStatus() == ProcessStatus.FAILED || instance.getStatus() == ProcessStatus.CANCELLED) {
                return done(End.FAILED, "the walk ended " + instance.getStatus(), null, path, confidence, cost,
                        unpriced, toolsSkipped);
            }
            var incidents = instance.takeIncidents();
            if (!incidents.isEmpty()) {
                var incident = incidents.getFirst();
                return done(End.FAILED, incident.type() + ": " + incident.message(), incident.activityId(), path,
                        confidence, cost, unpriced, toolsSkipped);
            }
            Stop stop = null;
            boolean moved = false;
            for (ProcessToken token : instance.getWaitingTokens()) {
                String activityId = token.activityId();
                TaskMeta human = definition.getUserTask(activityId);
                ServiceTaskMeta service = definition.getServiceTask(activityId);
                if (human != null) {
                    Optional<String> decision = humans.next(activityId);
                    if (decision.isEmpty()) {
                        stop = Stop.first(stop, End.NEEDS_HUMAN, "no recorded decision for '" + activityId + "'",
                                activityId);
                        continue;
                    }
                    String refused = decide(instance, definition, human, token, decision.get(), path);
                    if (refused != null) {
                        stop = Stop.first(stop, End.NEEDS_HUMAN, refused, activityId);
                        continue;
                    }
                    moved = true;
                    break;
                } else if (service != null && service.agentWork() != null) {
                    AgentWorkDescriptor work = service.agentWork();
                    if (!work.tools().isEmpty()) toolsSkipped.add(activityId);
                    AgentAnswer answer;
                    try {
                        answer = agents.run(activityId, work, AgentInputs.resolve(work, instance.getVariables()));
                    } catch (Exception failure) {
                        return done(End.FAILED, "agent call failed: " + failure.getMessage(), activityId, path,
                                confidence, cost, unpriced, toolsSkipped);
                    }
                    if (answer.costUsd() != null) cost = cost.add(answer.costUsd());
                    unpriced |= answer.costUnpriced();
                    AgentOutputValidator.Verdict verdict = AgentOutputValidator.validate(work,
                            resultVariable(work, activityId), answer.variables());
                    if (verdict.confidence() != null) confidence = verdict.confidence();
                    String failure = completeAgent(instance, definition, token, work, verdict, path);
                    if (failure != null) {
                        return done(End.FAILED, failure, activityId, path, confidence, cost, unpriced, toolsSkipped);
                    }
                    moved = true;
                    break;
                } else {
                    stop = Stop.first(stop, End.NEEDS_EXTERNAL, describeExternal(definition, activityId), activityId);
                }
            }
            if (!moved) {
                if (stop == null) {
                    return done(End.FAILED, "the walk has nothing left to run", null, path, confidence, cost,
                            unpriced, toolsSkipped);
                }
                return done(stop.end, stop.reason, stop.activityId, path, confidence, cost, unpriced, toolsSkipped);
            }
            drain(instance, path);
        }
        return done(End.FAILED, "the walk exceeded " + MAX_STEPS + " steps", null, path, confidence, cost, unpriced,
                toolsSkipped);
    }

    private record Stop(End end, String reason, String activityId) {
        static Stop first(Stop current, End end, String reason, String activityId) {
            return current != null ? current : new Stop(end, reason, activityId);
        }
    }

    private static Result done(End end, String reason, String stoppedAt, List<Step> path, Double confidence,
            BigDecimal cost, boolean unpriced, Set<String> toolsSkipped) {
        return new Result(end, reason, stoppedAt, List.copyOf(path), confidence, cost, unpriced,
                Set.copyOf(toolsSkipped));
    }

    private static String describeExternal(ParsedProcessDefinition definition, String activityId) {
        if (definition.getCallProcess(activityId) != null) {
            return "'" + activityId + "' calls another process, which is not replayed";
        }
        if (definition.getServiceTask(activityId) != null) {
            return "'" + activityId + "' is an engine task that only an external worker can run";
        }
        return "'" + activityId + "' waits for a timer, message or signal";
    }

    private static String resultVariable(AgentWorkDescriptor work, String activityId) {
        return work.resultVariable() == null || work.resultVariable().isBlank()
                ? activityId + "_result" : work.resultVariable();
    }

    /** Applies the recorded decision; returns why it cannot be honoured, or null once the token moved on. */
    private static String decide(ProcessInstance instance, ParsedProcessDefinition definition, TaskMeta task,
            ProcessToken token, String decision, List<Step> path) {
        String activityId = token.activityId();
        if (task.getOutcomes().isEmpty()) {
            path.add(new Step(activityId, Kind.HUMAN, "completed"));
            instance.advance(token.id());
            return null;
        }
        OutcomeMeta chosen = task.getOutcome(decision);
        if (chosen == null) {
            return "the recorded outcome '" + decision + "' is not an outcome of '" + activityId + "' any more";
        }
        Map<String, Object> decided = new HashMap<>();
        decided.put(AplParser.outcomeVariable(activityId), chosen.name());
        decided.put(AplParser.commentVariable(activityId), chosen.commentRequired() ? COMMENT_PLACEHOLDER : null);
        instance.putAllVariables(decided);
        path.add(new Step(activityId, Kind.HUMAN, chosen.name()));
        if (chosen.target() != null) {
            BoundaryMeta route = definition.boundaryFor(activityId, BoundaryMeta.Kind.OUTCOME, chosen.name());
            instance.leaveViaBoundary(token.id(), route);
        } else {
            instance.advance(token.id());
        }
        return null;
    }

    /** Mirrors the engine's handling of an agent completion; returns a failure message, or null once the token moved. */
    private static String completeAgent(ProcessInstance instance, ParsedProcessDefinition definition,
            ProcessToken token, AgentWorkDescriptor work, AgentOutputValidator.Verdict verdict, List<Step> path) {
        String activityId = token.activityId();
        String resultVariable = resultVariable(work, activityId);
        List<AgentRouteMeta> routes = definition.getAgentRoutes(activityId);
        AgentRouteMeta chosen = null;
        if (verdict.ok() && !routes.isEmpty()) {
            Object name = verdict.value() instanceof Map<?, ?> value ? value.get(AgentRouteMeta.RESULT_PROPERTY) : null;
            chosen = routes.stream().filter(route -> route.name().equals(name)).findFirst().orElse(null);
            if (chosen == null) {
                verdict = new AgentOutputValidator.Verdict(AplParser.OUTCOME_INVALID_OUTPUT, verdict.value(),
                        verdict.confidence(), "route '" + name + "' is not one this step declares");
            } else if (chosen.when() != null && !allowed(chosen, instance, resultVariable, verdict.value())) {
                verdict = new AgentOutputValidator.Verdict(AplParser.OUTCOME_INVALID_OUTPUT, verdict.value(),
                        verdict.confidence(), "route '" + chosen.name() + "' was vetoed by its when");
                chosen = null;
            }
        }
        BoundaryMeta boundary = chosen != null
                ? definition.boundaryFor(activityId, BoundaryMeta.Kind.ROUTE, chosen.name())
                : verdict.ok() ? null
                        : definition.boundaryFor(activityId, BoundaryMeta.Kind.valueOf(verdict.outcome()), null);
        if (!verdict.ok() && boundary == null) {
            return "the agent's output was rejected (" + verdict.outcome() + "): " + verdict.reason();
        }
        Map<String, Object> merged = new LinkedHashMap<>();
        if (!AplParser.OUTCOME_INVALID_OUTPUT.equals(verdict.outcome())) merged.put(resultVariable, verdict.value());
        if (!definition.boundariesOf(activityId).isEmpty()) {
            merged.put(AplParser.outcomeVariable(activityId), verdict.outcome());
        }
        if (!routes.isEmpty() && chosen != null) merged.put(AplParser.routeVariable(activityId), chosen.name());
        instance.putAllVariables(merged);
        path.add(new Step(activityId, Kind.AGENT, verdict.outcome()));
        if (chosen != null) path.add(new Step(activityId, Kind.ROUTE, chosen.name()));
        if (boundary == null) {
            instance.advance(token.id());
        } else {
            instance.leaveViaBoundary(token.id(), boundary);
        }
        return null;
    }

    private static boolean allowed(AgentRouteMeta route, ProcessInstance instance, String resultVariable,
            Object result) {
        Map<String, Object> scope = new HashMap<>(instance.getVariables());
        scope.put(resultVariable, result);
        try {
            return WorkflowExpressions.compile(route.when()).test(scope);
        } catch (ExpressionEvaluationException exception) {
            return false;
        }
    }

    /** Records the deterministic decisions taken while the token moved. */
    private static void drain(ProcessInstance instance, List<Step> path) {
        for (DecisionTableAudit audit : instance.takeDecisionAudits()) {
            path.add(new Step(audit.activityId(), Kind.DECISION, String.valueOf(audit.matchedRuleIndexes())));
        }
        instance.takeParked();
        instance.takeLoopExhaustions();
        instance.takeFlowsTaken();
    }
}
