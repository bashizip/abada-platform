package com.abada.engine.core;

import com.abada.engine.core.model.*;
import com.abada.engine.dto.UserTaskPayload;
import com.abada.engine.core.assignment.AssignmentEvaluator;
import com.abada.engine.spi.DelegateExecution;
import com.abada.engine.spi.JavaDelegate;
import com.abada.engine.util.DecisionTableEvaluator;
import java.time.Instant;
import java.util.*;

public class ProcessInstance {

    private String id;
    private ParsedProcessDefinition definition;
    private final Map<String, Object> variables = new HashMap<>();
    private Instant startDate;
    private Instant endDate;
    private ProcessStatus status;
    private boolean suspended = false;
    private String processDefinitionDeploymentId;
    private String projectId = com.abada.engine.project.ProjectConstants.DEFAULT_PROJECT_ID;
    private long entityVersion;
    private String startedBy = "system";

    /** Every token of this instance, in creation order; terminal tokens stay for lineage. */
    private final List<ProcessToken> tokens = new ArrayList<>();
    private Instant lastTokenCreatedAt = Instant.EPOCH;
    /** The stored token rows no longer describe this instance and must be replaced on save. */
    private boolean storedTokensStale;

    private final List<DecisionTableAudit> decisionAudits = new ArrayList<>();

    public ProcessInstance(ParsedProcessDefinition definition) {
        this.id = UUID.randomUUID().toString();
        this.definition = definition;
        this.tokens.add(newToken(definition.getStartEventId(), ProcessToken.State.WAITING, null, null));
        this.startDate = Instant.now();
        this.status = ProcessStatus.RUNNING;
    }

    public ProcessInstance(String id, ParsedProcessDefinition definition, List<String> activeTokens, Instant startDate,
            Instant endDate) {
        this.id = id;
        this.definition = definition;
        restoreLegacyTokens(activeTokens, Map.of(), Map.of());
        this.startDate = startDate;
        this.endDate = endDate;
        // The status will be set during rehydration in the engine
    }

    public ProcessInstance() {
        this.status = ProcessStatus.RUNNING;
    }

    public String getId() {
        return id;
    }

    public ParsedProcessDefinition getDefinition() {
        return definition;
    }

    public String getProcessDefinitionDeploymentId() {
        return processDefinitionDeploymentId;
    }

    public void setProcessDefinitionDeploymentId(String processDefinitionDeploymentId) {
        this.processDefinitionDeploymentId = processDefinitionDeploymentId;
    }

    public String getProjectId() { return projectId; }
    public void setProjectId(String value) { projectId = value; }

    public long getEntityVersion() { return entityVersion; }
    public void setEntityVersion(long entityVersion) { this.entityVersion = entityVersion; }
    public String getStartedBy() { return startedBy; }
    public void setStartedBy(String startedBy) { this.startedBy = startedBy; }

    /**
     * Activity ids of the waiting tokens, in creation order: the legacy
     * {@code active_tokens_json} view (event-gateway children appear as their
     * catch-event ids, never the gateway).
     */
    public List<String> getActiveTokens() {
        return tokens.stream().filter(token -> token.state() == ProcessToken.State.WAITING)
                .map(ProcessToken::activityId).toList();
    }

    /** Replaces the token set with root waiting tokens; an empty list cancels every live token. */
    public void setActiveTokens(List<String> activityIds) {
        cancelAllTokens();
        for (String activityId : activityIds) {
            tokens.add(newToken(activityId, ProcessToken.State.WAITING, null, null));
        }
    }

    public List<ProcessToken> getTokens() {
        return Collections.unmodifiableList(tokens);
    }

    public List<ProcessToken> getWaitingTokens() {
        return tokens.stream().filter(token -> token.state() == ProcessToken.State.WAITING).toList();
    }

    /** Tokens created or changed since the last {@link #markTokensClean()}. */
    public List<ProcessToken> getDirtyTokens() {
        return tokens.stream().filter(ProcessToken::isDirty).toList();
    }

    public void markTokensClean() {
        tokens.forEach(ProcessToken::markClean);
    }

    /** Loads stored token rows; replaces any token already held. */
    public void restoreTokens(List<ProcessToken> stored) {
        tokens.clear();
        tokens.addAll(stored);
        stored.stream().map(ProcessToken::createdAt).max(Comparator.naturalOrder())
                .ifPresent(latest -> lastTokenCreatedAt = latest);
    }

    public boolean isStoredTokensStale() { return storedTokensStale; }
    public void markStoredTokensStale() { storedTokensStale = true; }
    public void clearStoredTokensStale() { storedTokensStale = false; }

    /** Cancels every live token (instance cancel or fail). */
    public void cancelAllTokens() {
        tokens.stream().filter(token -> token.state().isLive())
                .forEach(token -> token.moveTo(token.activityId(), ProcessToken.State.CANCELLED));
    }

    /**
     * Legacy {@code join_expected_tokens_json} view, kept so a 1.0.0-rc.8 engine
     * can still read this instance: join id to the number of branches it waits for.
     */
    public Map<String, Integer> getJoinExpectedTokens() {
        Map<String, Integer> expected = new LinkedHashMap<>();
        for (ProcessToken fork : tokens) {
            if (fork.state() != ProcessToken.State.FORKED) continue;
            String join = joinOf(fork);
            if (join != null) {
                expected.put(join, (int) childrenOf(fork).stream().filter(child -> child.state().isLive()).count());
            }
        }
        return Collections.unmodifiableMap(expected);
    }

    /** Legacy {@code join_arrived_tokens_json} view: join id to the ids of the tokens parked there. */
    public Map<String, Set<String>> getJoinArrivedTokens() {
        Map<String, Set<String>> arrived = new LinkedHashMap<>();
        for (ProcessToken fork : tokens) {
            if (fork.state() != ProcessToken.State.FORKED) continue;
            String join = joinOf(fork);
            if (join != null) arrived.put(join, new LinkedHashSet<>());
        }
        for (ProcessToken token : tokens) {
            if (token.state() == ProcessToken.State.ARRIVED) {
                arrived.computeIfAbsent(token.activityId(), key -> new LinkedHashSet<>()).add(token.id());
            }
        }
        Map<String, Set<String>> snapshot = new LinkedHashMap<>();
        arrived.forEach((join, ids) -> snapshot.put(join, Set.copyOf(ids)));
        return Collections.unmodifiableMap(snapshot);
    }

    /**
     * Rebuilds tokens from the pre-V23 JSON state (activity ids plus join
     * bookkeeping keyed by gateway). Each join with bookkeeping becomes a forked
     * token with one arrived child per recorded arrival; every waiting activity
     * that can still reach such a join becomes another child of it. Children of
     * the same event gateway share one parked branch token.
     *
     * @return human-readable inconsistencies (a join whose recorded expectation
     *         differs from the branches found); the state is converted anyway
     */
    public List<String> restoreLegacyTokens(List<String> activeActivityIds, Map<String, Integer> joinExpected,
            Map<String, Set<String>> joinArrived) {
        tokens.clear();
        List<String> warnings = new ArrayList<>();
        Map<String, ProcessToken> forkByJoin = new LinkedHashMap<>();
        Set<String> joins = new LinkedHashSet<>(joinExpected == null ? Set.of() : joinExpected.keySet());
        if (joinArrived != null) joins.addAll(joinArrived.keySet());
        for (String join : joins) {
            String forkActivity = definition.findForkOf(join);
            ProcessToken fork = newToken(forkActivity != null ? forkActivity : join,
                    ProcessToken.State.FORKED, null, null);
            tokens.add(fork);
            forkByJoin.put(join, fork);
            int arrivals = joinArrived == null ? 0 : joinArrived.getOrDefault(join, Set.of()).size();
            for (int i = 0; i < arrivals; i++) {
                tokens.add(newToken(join, ProcessToken.State.ARRIVED, fork.id(), fork.id()));
            }
        }
        Map<String, ProcessToken> parkedByEventGateway = new LinkedHashMap<>();
        for (String activity : activeActivityIds == null ? List.<String>of() : activeActivityIds) {
            String gateway = definition.getEventGatewayOf(activity);
            String streamStart = gateway != null ? gateway : activity;
            String join = firstReachable(streamStart, forkByJoin.keySet());
            String scope = join == null ? null : forkByJoin.get(join).id();
            if (gateway != null) {
                ProcessToken parked = parkedByEventGateway.computeIfAbsent(gateway, key -> {
                    ProcessToken branch = newToken(key, ProcessToken.State.EVENT_WAIT, scope, scope);
                    tokens.add(branch);
                    return branch;
                });
                tokens.add(newToken(activity, ProcessToken.State.WAITING, parked.id(), parked.scopeTokenId()));
            } else {
                tokens.add(newToken(activity, ProcessToken.State.WAITING, scope, scope));
            }
        }
        if (joinExpected != null) {
            forkByJoin.forEach((join, fork) -> {
                Integer expected = joinExpected.get(join);
                long branches = childrenOf(fork).size();
                if (expected != null && expected != branches) {
                    warnings.add("join '" + join + "' expected " + expected + " branch(es) but " + branches
                            + " were found");
                }
            });
        }
        return warnings;
    }

    public Instant getStartDate() {
        return startDate;
    }

    public Instant getEndDate() {
        return endDate;
    }

    public void setEndDate(Instant endDate) {
        this.endDate = endDate;
    }

    public ProcessStatus getStatus() {
        return status;
    }

    public void setStatus(ProcessStatus status) {
        this.status = status;
    }

    public boolean isSuspended() {
        return suspended;
    }

    public void setSuspended(boolean suspended) {
        this.suspended = suspended;
    }

    public void setVariable(String key, Object value) {
        variables.put(key, value);
    }

    public Object getVariable(String key) {
        return variables.get(key);
    }

    public Map<String, Object> getVariables() {
        return Collections.unmodifiableMap(variables);
    }

    public void putAllVariables(Map<String, Object> newVars) {
        if (newVars != null)
            variables.putAll(newVars);
    }

    public boolean isWaitingForUserTask() {
        return getActiveTokens().stream().anyMatch(definition::isUserTask);
    }

    public boolean isCompleted() {
        return this.status == ProcessStatus.COMPLETED;
    }

    /** Moves every waiting token that is not at a wait state (the start token of a new instance). */
    public List<UserTaskPayload> advance() {
        List<UserTaskPayload> newUserTasks = new ArrayList<>();
        Deque<Step> queue = new ArrayDeque<>();
        for (ProcessToken token : List.copyOf(tokens)) {
            if (token.state() == ProcessToken.State.WAITING) {
                token.moveTo(token.activityId(), ProcessToken.State.ACTIVE);
                queue.add(new Step(token, token.activityId(), null));
            }
        }
        return run(queue, newUserTasks);
    }

    /**
     * Resumes one waiting token past its wait state.
     *
     * @param tokenRef the token id, or (for work created before tokens were
     *        stored) the activity id; the oldest token waiting there resumes
     * @throws com.abada.engine.core.exception.ProcessEngineException when no
     *         token is waiting there
     */
    public List<UserTaskPayload> advance(String tokenRef) {
        if (tokenRef == null) return advance();
        List<UserTaskPayload> newUserTasks = new ArrayList<>();
        Deque<Step> queue = new ArrayDeque<>();
        ProcessToken resumed = waitingToken(tokenRef);
        String resumedActivity = resumed.activityId();
        ProcessToken mover = resumed;
        ProcessToken parent = find(resumed.parentTokenId());
        if (parent != null && parent.state() == ProcessToken.State.EVENT_WAIT) {
            // The winning catch event of an event gateway: its siblings lose, and
            // the branch token parked at the gateway continues on its path.
            for (ProcessToken sibling : childrenOf(parent)) {
                if (sibling != resumed && sibling.state().isLive()) {
                    sibling.moveTo(sibling.activityId(), ProcessToken.State.CANCELLED);
                }
            }
            resumed.moveTo(resumedActivity, ProcessToken.State.CONSUMED);
            mover = parent;
        }
        mover.moveTo(resumedActivity, ProcessToken.State.ACTIVE);
        continueAfter(mover, resumedActivity, queue);
        return run(queue, newUserTasks);
    }

    /**
     * The other catch events competing with the event a waiting token is parked
     * at, or an empty result when that token is not an event-gateway child.
     */
    public EventRace eventRace(String tokenRef) {
        ProcessToken waiting = waitingToken(tokenRef);
        ProcessToken parent = find(waiting.parentTokenId());
        if (parent == null || parent.state() != ProcessToken.State.EVENT_WAIT) {
            return new EventRace(waiting.id(), List.of(), List.of());
        }
        List<ProcessToken> losers = childrenOf(parent).stream()
                .filter(child -> child != waiting && child.state().isLive()).toList();
        return new EventRace(waiting.id(), losers.stream().map(ProcessToken::id).toList(),
                losers.stream().map(ProcessToken::activityId).toList());
    }

    public record EventRace(String winnerTokenId, List<String> loserTokenIds, List<String> loserActivityIds) {}

    private record Step(ProcessToken token, String pointer, String previous) {}

    private static final int MAX_HOPS = 2048;

    private List<UserTaskPayload> run(Deque<Step> queue, List<UserTaskPayload> newUserTasks) {
        while (!queue.isEmpty()) {
            move(queue.poll(), queue, newUserTasks);
        }
        if (tokens.stream().noneMatch(token -> token.state().isLive())) {
            this.status = ProcessStatus.COMPLETED;
        }
        return newUserTasks;
    }

    /** Moves one token until it parks, forks, joins or ends. Hops are bounded per token, not per run. */
    private void move(Step step, Deque<Step> queue, List<UserTaskPayload> newUserTasks) {
        ProcessToken token = step.token();
        String current = step.pointer();
        int hops = 0;
        while (current != null) {
            if (++hops > MAX_HOPS) {
                throw new IllegalStateException(
                        "advance() exceeded max hops; possible cycle without wait state. pi=" + id);
            }
            String pointer = current;
            token.moveTo(pointer, ProcessToken.State.ACTIVE);
            current = null;

            ServiceTaskMeta serviceTaskMeta = definition.getServiceTask(pointer);
            boolean isExternalServiceTask = serviceTaskMeta != null && serviceTaskMeta.topicName() != null;
            boolean isEmbeddedServiceTask = serviceTaskMeta != null && serviceTaskMeta.className() != null;
            ScriptTaskMeta scriptTaskMeta = definition.getScriptTask(pointer);

            if (definition.isUserTask(pointer) || definition.isCatchEvent(pointer) || isExternalServiceTask) {
                token.moveTo(pointer, ProcessToken.State.WAITING);
                if (definition.isUserTask(pointer)) {
                    TaskMeta ut = definition.getUserTask(pointer);
                    var resolved = new AssignmentEvaluator().evaluate(ut.getAssignment(), variables);
                    newUserTasks.add(new UserTaskPayload(ut.getId(), ut.getName(), resolved.assignee(),
                            resolved.candidateUsers(), resolved.candidateGroups(), ut.getFormKey(), resolved.strategy(),
                            token.id()));
                }
                return;
            } else if (isEmbeddedServiceTask) {
                if (!com.abada.engine.expression.ExecutionPolicy.delegateAllowed(serviceTaskMeta.className())) {
                    throw new com.abada.engine.core.exception.ProcessEngineException("Java delegate '"
                            + serviceTaskMeta.className() + "' is not on the operator allow-list ("
                            + com.abada.engine.expression.ExecutionPolicy.ALLOWED_DELEGATES + ")");
                }
                try {
                    JavaDelegate delegate = (JavaDelegate) Class.forName(serviceTaskMeta.className())
                            .getConstructor().newInstance();
                    delegate.execute(new DelegateExecutionImpl());
                    current = firstTarget(pointer);
                } catch (Exception e) {
                    throw new RuntimeException("Error executing JavaDelegate " + serviceTaskMeta.className(), e);
                }
            } else if (scriptTaskMeta != null) {
                executeScript(scriptTaskMeta);
                current = firstTarget(pointer);
            } else if (definition.isDecisionTable(pointer)) {
                // Deterministic decision-table evaluation inside the workflow
                // transaction: the table is the law, agents are the advice.
                DecisionTableMeta table = definition.getDecisionTable(pointer);
                DecisionTableEvaluator.Result result = DecisionTableEvaluator.evaluate(table, variables);
                variables.putAll(result.outputs());
                decisionAudits.add(new DecisionTableAudit(java.util.UUID.randomUUID().toString(), pointer, table.decisionKey(),
                        result.matchedRuleIndexes(), List.copyOf(result.inputs().keySet()),
                        List.copyOf(result.outputs().keySet())));
                current = firstTarget(pointer);
            } else if (definition.isExclusiveGateway(pointer)) {
                GatewaySelector selector = new GatewaySelector();
                GatewayMeta gw = definition.getGateways().get(pointer);
                List<SequenceFlow> outgoing = definition.getOutgoing(pointer);
                String chosenFlowId = selector.chooseOutgoing(gw, outgoing, variables);
                current = outgoing.stream()
                        .filter(f -> Objects.equals(f.getId(), chosenFlowId))
                        .map(SequenceFlow::getTargetRef)
                        .findFirst()
                        .orElseThrow(() -> new IllegalStateException("Flow not found: " + chosenFlowId));
            } else if (definition.isParallelGateway(pointer) && definition.getIncoming(pointer).size() == 1) {
                fork(token, pointer, definition.getOutgoing(pointer).stream()
                        .map(SequenceFlow::getTargetRef).toList(), queue);
                return;
            } else if (definition.isInclusiveGateway(pointer) && definition.getIncoming(pointer).size() == 1) {
                GatewaySelector selector = new GatewaySelector();
                GatewayMeta gw = definition.getGateways().get(pointer);
                List<SequenceFlow> outgoing = definition.getOutgoing(pointer);
                List<String> chosenFlowIds = selector.chooseInclusive(gw, outgoing, variables);
                fork(token, pointer, chosenFlowIds.stream()
                        .map(flowId -> outgoing.stream().filter(f -> f.getId().equals(flowId)).findFirst()
                                .orElseThrow().getTargetRef())
                        .toList(), queue);
                return;
            } else if (definition.isEventGateway(pointer)) {
                // Event gateway: a competing wait point, never a pass-through.
                // The token parks here and every catch child waits as its own
                // token; the first child to fire resumes this token and the
                // engine cancels the sibling wait states in the same transaction.
                token.moveTo(pointer, ProcessToken.State.EVENT_WAIT);
                for (String child : definition.getEventGatewayChildren(pointer)) {
                    tokens.add(newToken(child, ProcessToken.State.WAITING, token.id(), token.scopeTokenId()));
                }
                return;
            } else if ((definition.isParallelGateway(pointer) || definition.isInclusiveGateway(pointer))
                    && definition.getIncoming(pointer).size() > 1) {
                token.moveTo(pointer, ProcessToken.State.ARRIVED);
                arrive(token, pointer, queue);
                return;
            } else if (definition.isEndEvent(pointer)) {
                end(token, pointer, queue);
                return;
            } else {
                current = firstTarget(pointer);
            }
            if (current == null) {
                end(token, pointer, queue);
                return;
            }
        }
    }

    /** The forking token waits; one child token per chosen branch runs in this command. */
    private void fork(ProcessToken token, String gateway, List<String> targets, Deque<Step> queue) {
        token.moveTo(gateway, ProcessToken.State.FORKED);
        for (String target : targets) {
            ProcessToken child = newToken(target, ProcessToken.State.ACTIVE, token.id(), token.id());
            tokens.add(child);
            queue.add(new Step(child, target, gateway));
        }
        settle(token, queue);
    }

    /**
     * A token reached a join. At the join that closes its fork scope, the scope
     * settles. Any other join is a merge: it waits for
     * {@code logicalIncomingCount} arrivals, or fires with the arrivals it has
     * once no other live token of the same scope can still reach it.
     */
    private void arrive(ProcessToken token, String join, Deque<Step> queue) {
        ProcessToken fork = find(token.scopeTokenId());
        if (fork != null && fork.state() == ProcessToken.State.FORKED && join.equals(joinOf(fork))) {
            settle(fork, queue);
            return;
        }
        List<ProcessToken> arrived = tokens.stream()
                .filter(other -> other.state() == ProcessToken.State.ARRIVED && join.equals(other.activityId())
                        && Objects.equals(other.scopeTokenId(), token.scopeTokenId()))
                .toList();
        boolean othersCanArrive = tokens.stream()
                .anyMatch(other -> other.state().isLive() && other.state() != ProcessToken.State.ARRIVED
                        && Objects.equals(other.scopeTokenId(), token.scopeTokenId())
                        && canReach(other.activityId(), join));
        if (arrived.size() >= definition.logicalIncomingCount(join) || !othersCanArrive) {
            arrived.stream().filter(other -> other != token)
                    .forEach(other -> other.moveTo(join, ProcessToken.State.CONSUMED));
            token.moveTo(join, ProcessToken.State.ACTIVE);
            continueAfter(token, join, queue);
        }
    }

    /**
     * Resolves a fork scope: when every live child has arrived at the same join,
     * the children are consumed and the forking token continues after the join;
     * when every child has ended, the forking token ends too. Children that
     * ended at an end event inside the scope no longer count toward the join.
     */
    private void settle(ProcessToken fork, Deque<Step> queue) {
        if (fork == null || fork.state() != ProcessToken.State.FORKED) return;
        List<ProcessToken> live = childrenOf(fork).stream().filter(child -> child.state().isLive()).toList();
        if (live.isEmpty()) {
            fork.moveTo(fork.activityId(), ProcessToken.State.COMPLETED);
            settle(find(fork.scopeTokenId()), queue);
            return;
        }
        String join = joinOf(fork);
        boolean allArrived = live.stream().allMatch(child -> child.state() == ProcessToken.State.ARRIVED
                && child.activityId().equals(join));
        if (!allArrived) return;
        live.forEach(child -> child.moveTo(join, ProcessToken.State.CONSUMED));
        fork.moveTo(join, ProcessToken.State.ACTIVE);
        continueAfter(fork, join, queue);
    }

    private void end(ProcessToken token, String activity, Deque<Step> queue) {
        token.moveTo(activity, ProcessToken.State.COMPLETED);
        settle(find(token.scopeTokenId()), queue);
    }

    private void continueAfter(ProcessToken token, String activity, Deque<Step> queue) {
        String next = firstTarget(activity);
        if (next == null) {
            end(token, activity, queue);
        } else {
            queue.add(new Step(token, next, activity));
        }
    }

    private String firstTarget(String activity) {
        List<SequenceFlow> outgoing = definition.getOutgoing(activity);
        return outgoing.isEmpty() ? null : outgoing.get(0).getTargetRef();
    }

    private ProcessToken waitingToken(String tokenRef) {
        for (ProcessToken token : tokens) {
            if (token.id().equals(tokenRef) && token.state() == ProcessToken.State.WAITING) return token;
        }
        for (ProcessToken token : tokens) {
            if (token.activityId().equals(tokenRef) && token.state() == ProcessToken.State.WAITING) return token;
        }
        throw new com.abada.engine.core.exception.ProcessEngineException(
                "No token is waiting at '" + tokenRef + "' in process instance " + id);
    }

    private ProcessToken find(String tokenId) {
        if (tokenId == null) return null;
        for (ProcessToken token : tokens) {
            if (token.id().equals(tokenId)) return token;
        }
        return null;
    }

    private List<ProcessToken> childrenOf(ProcessToken parent) {
        return tokens.stream().filter(token -> parent.id().equals(token.parentTokenId())).toList();
    }

    /**
     * The join that closes a fork scope: the structural join of the fork
     * gateway, or the gateway itself for a scope rebuilt from pre-V23 state
     * whose fork could not be identified.
     */
    private String joinOf(ProcessToken fork) {
        String activity = fork.activityId();
        GatewayMeta gateway = definition.getGateways().get(activity);
        if (gateway == null) return null;
        if (definition.getIncoming(activity).size() > 1) return activity;
        return definition.findJoinGateway(activity, gateway.type());
    }

    private boolean canReach(String from, String target) {
        return firstReachable(from, Set.of(target)) != null;
    }

    /** The first of {@code targets} found walking forward from {@code from} (inclusive), or null. */
    private String firstReachable(String from, Set<String> targets) {
        if (targets.isEmpty()) return null;
        Deque<String> pending = new ArrayDeque<>(List.of(from));
        Set<String> seen = new HashSet<>();
        while (!pending.isEmpty()) {
            String node = pending.poll();
            if (!seen.add(node)) continue;
            if (targets.contains(node)) return node;
            for (SequenceFlow flow : definition.getOutgoing(node)) pending.add(flow.getTargetRef());
        }
        return null;
    }

    private ProcessToken newToken(String activityId, ProcessToken.State state, String parentTokenId,
            String scopeTokenId) {
        Instant now = Instant.now();
        // Strictly increasing creation times keep the stored order stable.
        lastTokenCreatedAt = now.isAfter(lastTokenCreatedAt) ? now : lastTokenCreatedAt.plusNanos(1_000);
        return ProcessToken.create(activityId, state, parentTokenId, scopeTokenId, lastTokenCreatedAt);
    }

    /** Immutable view of decision tables applied during the last advance(). */
    public List<DecisionTableAudit> getDecisionAudits() {
        return List.copyOf(decisionAudits);
    }

    /** Returns and clears the decision-table audits produced by advance(). */
    public List<DecisionTableAudit> takeDecisionAudits() {
        List<DecisionTableAudit> snapshot = List.copyOf(decisionAudits);
        decisionAudits.clear();
        return snapshot;
    }

    private void executeScript(ScriptTaskMeta task) {
        variables.putAll(com.abada.engine.expression.ScriptSandbox.execute(task.id(), task.script(), variables));
    }

    private class DelegateExecutionImpl implements DelegateExecution {
        @Override
        public String getProcessInstanceId() {
            return ProcessInstance.this.id;
        }

        @Override
        public Map<String, Object> getVariables() {
            return Collections.unmodifiableMap(ProcessInstance.this.variables);
        }

        @Override
        public Object getVariable(String name) {
            return ProcessInstance.this.variables.get(name);
        }

        @Override
        public void setVariable(String name, Object value) {
            ProcessInstance.this.variables.put(name, value);
        }
    }
}
