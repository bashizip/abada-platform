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

    private final List<String> activeTokens = new ArrayList<>();
    private final Map<String, Integer> joinExpectedTokens = new HashMap<>();
    private final Map<String, Set<String>> joinArrivedTokens = new HashMap<>();

    private final List<DecisionTableAudit> decisionAudits = new ArrayList<>();

    public ProcessInstance(ParsedProcessDefinition definition) {
        this.id = UUID.randomUUID().toString();
        this.definition = definition;
        this.activeTokens.add(definition.getStartEventId());
        this.startDate = Instant.now();
        this.status = ProcessStatus.RUNNING;
    }

    public ProcessInstance(String id, ParsedProcessDefinition definition, List<String> activeTokens, Instant startDate,
            Instant endDate) {
        this.id = id;
        this.definition = definition;
        this.activeTokens.addAll(activeTokens);
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

    public List<String> getActiveTokens() {
        return Collections.unmodifiableList(activeTokens);
    }

    public void setActiveTokens(List<String> tokens) {
        activeTokens.clear();
        activeTokens.addAll(tokens);
    }

    public Map<String, Integer> getJoinExpectedTokens() {
        return Collections.unmodifiableMap(joinExpectedTokens);
    }

    public void setJoinExpectedTokens(Map<String, Integer> state) {
        joinExpectedTokens.clear();
        if (state != null) joinExpectedTokens.putAll(state);
    }

    public Map<String, Set<String>> getJoinArrivedTokens() {
        Map<String, Set<String>> snapshot = new HashMap<>();
        joinArrivedTokens.forEach((key, value) -> snapshot.put(key, Set.copyOf(value)));
        return Collections.unmodifiableMap(snapshot);
    }

    public void setJoinArrivedTokens(Map<String, Set<String>> state) {
        joinArrivedTokens.clear();
        if (state != null) state.forEach((key, value) -> joinArrivedTokens.put(key, new HashSet<>(value)));
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
        return !activeTokens.isEmpty() && activeTokens.stream().anyMatch(t -> definition.isUserTask(t));
    }

    public boolean isCompleted() {
        return this.status == ProcessStatus.COMPLETED;
    }

    public List<UserTaskPayload> advance() {
        return advance(null);
    }

    public List<UserTaskPayload> advance(String resumedNodeId) {
        List<UserTaskPayload> newUserTasks = new ArrayList<>();
        Queue<String> queue = new LinkedList<>();

        if (resumedNodeId != null) {
            activeTokens.remove(resumedNodeId);
            queue.add(resumedNodeId);
        } else {
            queue.addAll(activeTokens);
            activeTokens.clear();
        }

        Set<String> processedInThisRun = new HashSet<>();

        while (!queue.isEmpty()) {
            String current = queue.poll();
            String previousPointer = null;

            if (processedInThisRun.contains(current)) {
                continue;
            }

            int hops = 0;
            final int MAX_HOPS = 2048;

            while (current != null && !processedInThisRun.contains(current)) {
                if (++hops > MAX_HOPS) {
                    throw new IllegalStateException(
                            "advance() exceeded max hops; possible cycle without wait state. pi=" + id);
                }

                String pointer = current;
                processedInThisRun.add(pointer);

                ServiceTaskMeta serviceTaskMeta = definition.getServiceTask(pointer);
                boolean isExternalServiceTask = serviceTaskMeta != null && serviceTaskMeta.topicName() != null;
                boolean isEmbeddedServiceTask = serviceTaskMeta != null && serviceTaskMeta.className() != null;
                ScriptTaskMeta scriptTaskMeta = definition.getScriptTask(pointer);

                if (definition.isUserTask(pointer) || definition.isCatchEvent(pointer) || isExternalServiceTask) {
                    if (Objects.equals(pointer, resumedNodeId)) {
                        var outgoing = definition.getOutgoing(pointer);
                        current = outgoing.isEmpty() ? null : outgoing.get(0).getTargetRef();
                        previousPointer = pointer;
                    } else {
                        activeTokens.add(pointer);
                        if (definition.isUserTask(pointer)) {
                            TaskMeta ut = definition.getUserTask(pointer);
                            var resolved = new AssignmentEvaluator().evaluate(ut.getAssignment(), variables);
                            newUserTasks.add(new UserTaskPayload(ut.getId(), ut.getName(), resolved.assignee(),
                                    resolved.candidateUsers(), resolved.candidateGroups(), resolved.strategy()));
                        }
                        current = null;
                    }
                } else if (isEmbeddedServiceTask) {
                    try {
                        JavaDelegate delegate = (JavaDelegate) Class.forName(serviceTaskMeta.className())
                                .getConstructor().newInstance();
                        delegate.execute(new DelegateExecutionImpl());
                        previousPointer = pointer;
                        List<SequenceFlow> outgoing = definition.getOutgoing(pointer);
                        current = outgoing.isEmpty() ? null : outgoing.get(0).getTargetRef();
                    } catch (Exception e) {
                        throw new RuntimeException("Error executing JavaDelegate " + serviceTaskMeta.className(), e);
                    }
                } else if (scriptTaskMeta != null) {
                    executeScript(scriptTaskMeta);
                    previousPointer = pointer;
                    List<SequenceFlow> outgoing = definition.getOutgoing(pointer);
                    current = outgoing.isEmpty() ? null : outgoing.get(0).getTargetRef();
                } else if (definition.isDecisionTable(pointer)) {
                    // Deterministic decision-table evaluation inside the workflow
                    // transaction: the table is the law, agents are the advice.
                    DecisionTableMeta table = definition.getDecisionTable(pointer);
                    DecisionTableEvaluator.Result result = DecisionTableEvaluator.evaluate(table, variables);
                    variables.putAll(result.outputs());
                    decisionAudits.add(new DecisionTableAudit(java.util.UUID.randomUUID().toString(), pointer, table.decisionKey(),
                            result.matchedRuleIndexes(), List.copyOf(result.inputs().keySet()),
                            List.copyOf(result.outputs().keySet())));
                    previousPointer = pointer;
                    List<SequenceFlow> outgoing = definition.getOutgoing(pointer);
                    current = outgoing.isEmpty() ? null : outgoing.get(0).getTargetRef();
                } else if (definition.isExclusiveGateway(pointer)) {
                    GatewaySelector selector = new GatewaySelector();
                    GatewayMeta gw = definition.getGateways().get(pointer);
                    List<SequenceFlow> outgoing = definition.getOutgoing(pointer);
                    String chosenFlowId = selector.chooseOutgoing(gw, outgoing, variables);
                    previousPointer = pointer;
                    current = outgoing.stream()
                            .filter(f -> Objects.equals(f.getId(), chosenFlowId))
                            .map(SequenceFlow::getTargetRef)
                            .findFirst()
                            .orElseThrow(() -> new IllegalStateException("Flow not found: " + chosenFlowId));
                } else if (definition.isParallelGateway(pointer) && definition.getIncoming(pointer).size() == 1) {
                    List<SequenceFlow> outgoing = definition.getOutgoing(pointer);
                    for (SequenceFlow flow : outgoing) {
                        queue.add(flow.getTargetRef());
                    }
                    String joinGatewayId = definition.findJoinGateway(pointer, GatewayMeta.Type.PARALLEL);
                    if (joinGatewayId != null) {
                        joinExpectedTokens.put(joinGatewayId, definition.logicalIncomingCount(joinGatewayId));
                        joinArrivedTokens.put(joinGatewayId, new HashSet<>());
                    }
                    current = null;
                } else if (definition.isInclusiveGateway(pointer) && definition.getIncoming(pointer).size() == 1) {
                    GatewaySelector selector = new GatewaySelector();
                    GatewayMeta gw = definition.getGateways().get(pointer);
                    List<SequenceFlow> outgoing = definition.getOutgoing(pointer);
                    List<String> chosenFlowIds = selector.chooseInclusive(gw, outgoing, variables);

                    for (String flowId : chosenFlowIds) {
                        queue.add(outgoing.stream().filter(f -> f.getId().equals(flowId)).findFirst().orElseThrow()
                                .getTargetRef());
                    }
                    String joinGatewayId = definition.findJoinGateway(pointer, GatewayMeta.Type.INCLUSIVE);
                    if (joinGatewayId != null) {
                        joinExpectedTokens.put(joinGatewayId, chosenFlowIds.size());
                        joinArrivedTokens.put(joinGatewayId, new HashSet<>());
                    }
                    current = null;
                } else if (definition.isEventGateway(pointer)) {
                    // Event gateway: a competing wait point, never a pass-through.
                    // Every catch child becomes an active wait token; the first
                    // child to fire advances the instance and the engine cancels
                    // the sibling wait states in the same transaction.
                    for (String child : definition.getEventGatewayChildren(pointer)) {
                        queue.add(child);
                    }
                    current = null;
                } else if ((definition.isParallelGateway(pointer) || definition.isInclusiveGateway(pointer))
                        && definition.getIncoming(pointer).size() > 1) {
                    int expected = joinExpectedTokens.getOrDefault(pointer, definition.logicalIncomingCount(pointer));
                    Set<String> arrived = joinArrivedTokens.computeIfAbsent(pointer, k -> new HashSet<>());
                    arrived.add(previousPointer);

                    if (arrived.size() >= expected) {
                        joinArrivedTokens.remove(pointer);
                        joinExpectedTokens.remove(pointer);
                        previousPointer = pointer;
                        current = definition.getOutgoing(pointer).get(0).getTargetRef();
                    } else {
                        current = null;
                    }
                } else if (definition.isEndEvent(pointer)) {
                    current = null;
                } else {
                    List<SequenceFlow> outgoing = definition.getOutgoing(pointer);
                    previousPointer = pointer;
                    current = outgoing.isEmpty() ? null : outgoing.get(0).getTargetRef();
                }
            }
        }

        if (activeTokens.isEmpty()) {
            this.status = ProcessStatus.COMPLETED;
        }

        return newUserTasks;
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
        javax.script.ScriptEngine engine = new javax.script.ScriptEngineManager().getEngineByName("JavaScript");
        if (engine == null) throw new IllegalStateException("JavaScript engine is unavailable");
        Map<String, Object> scriptVariables = new HashMap<>(variables);
        javax.script.Bindings bindings = engine.createBindings();
        bindings.putAll(scriptVariables);
        bindings.put("variables", scriptVariables);
        try {
            engine.eval(task.script(), bindings);
            variables.putAll(scriptVariables);
            bindings.forEach((key, value) -> {
                if (!"variables".equals(key)) variables.put(key, value);
            });
        } catch (javax.script.ScriptException ex) {
            throw new IllegalStateException("Script task failed: " + task.id(), ex);
        }
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
