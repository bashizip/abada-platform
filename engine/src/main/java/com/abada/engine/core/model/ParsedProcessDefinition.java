package com.abada.engine.core.model;

import java.io.Serializable;
import java.util.*;
import java.util.stream.Collectors;

public class ParsedProcessDefinition implements Serializable {

    private final String id;
    private final String name;
    private final String documentation;
    private final String startEventId;
    private final Map<String, TaskMeta> userTasks;
    private final Map<String, ServiceTaskMeta> serviceTasks;
    private final Map<String, ScriptTaskMeta> scriptTasks;
    private final Map<String, DecisionTableMeta> decisionTables;
    private final List<SequenceFlow> sequenceFlows;
    private final Map<String, GatewayMeta> gateways;
    private final Map<String, EventMeta> events;
    private final Map<String, Object> endEvents;
    private final String rawXml;
    private final List<String> candidateStarterGroups;
    private final List<String> candidateStarterUsers;
    private final Map<String, List<SequenceFlow>> outgoingBySource = new HashMap<>();
    private final Map<String, List<SequenceFlow>> incomingByTarget = new HashMap<>();

    private final Map<String, List<String>> flowGraph = new HashMap<>();
    private Map<String, LoopMeta> loops = Map.of();
    private Map<String, CallProcessMeta> callProcesses = Map.of();
    private Set<String> sensitiveVariables = Set.of();
    /** Agent node id to its {@code evidence} override: payloads mode (wire name) and retention days. */
    private Map<String, EvidenceOverride> evidenceOverrides = Map.of();

    /** A node's {@code evidence: { payloads, retention_days }}; null fields leave the project's setting. */
    public record EvidenceOverride(String payloads, Integer retentionDays) implements java.io.Serializable {}
    private Map<String, List<BoundaryMeta>> boundaries = Map.of();
    /** Back-edges of the depth-first walk from the start event, keyed by {@link #edgeKey}. */
    private final Set<String> backEdges = new LinkedHashSet<>();

    public List<SequenceFlow> getOutgoing(String sourceId) {
        return outgoingBySource.getOrDefault(sourceId, List.of());
    }

    public List<SequenceFlow> getIncoming(String targetId) {
        return incomingByTarget.getOrDefault(targetId, List.of());
    }

    public ParsedProcessDefinition(String id, String name, String documentation, String startEventId,
            Map<String, TaskMeta> userTasks,
            Map<String, ServiceTaskMeta> serviceTasks,
            List<SequenceFlow> sequenceFlows,
            Map<String, GatewayMeta> gateways,
            Map<String, EventMeta> events,
            Map<String, Object> endEvents,
            String rawXml,
            List<String> candidateStarterGroups,
            List<String> candidateStarterUsers) {
        this(id, name, documentation, startEventId, userTasks, serviceTasks, Map.of(), Map.of(), sequenceFlows,
                gateways, events, endEvents, rawXml, candidateStarterGroups, candidateStarterUsers);
    }

    public ParsedProcessDefinition(String id, String name, String documentation, String startEventId,
            Map<String, TaskMeta> userTasks,
            Map<String, ServiceTaskMeta> serviceTasks,
            Map<String, ScriptTaskMeta> scriptTasks,
            List<SequenceFlow> sequenceFlows,
            Map<String, GatewayMeta> gateways,
            Map<String, EventMeta> events,
            Map<String, Object> endEvents,
            String rawXml,
            List<String> candidateStarterGroups,
            List<String> candidateStarterUsers) {
        this(id, name, documentation, startEventId, userTasks, serviceTasks, scriptTasks, Map.of(), sequenceFlows,
                gateways, events, endEvents, rawXml, candidateStarterGroups, candidateStarterUsers);
    }

    public ParsedProcessDefinition(String id, String name, String documentation, String startEventId,
            Map<String, TaskMeta> userTasks,
            Map<String, ServiceTaskMeta> serviceTasks,
            Map<String, ScriptTaskMeta> scriptTasks,
            Map<String, DecisionTableMeta> decisionTables,
            List<SequenceFlow> sequenceFlows,
            Map<String, GatewayMeta> gateways,
            Map<String, EventMeta> events,
            Map<String, Object> endEvents,
            String rawXml,
            List<String> candidateStarterGroups,
            List<String> candidateStarterUsers) {
        this.id = id;
        this.name = name;
        this.documentation = documentation;
        this.startEventId = startEventId;
        this.userTasks = Collections.unmodifiableMap(new HashMap<>(userTasks));
        this.serviceTasks = Collections.unmodifiableMap(new HashMap<>(serviceTasks));
        this.scriptTasks = Collections.unmodifiableMap(new HashMap<>(scriptTasks));
        this.decisionTables = Collections.unmodifiableMap(new HashMap<>(decisionTables));
        this.sequenceFlows = Collections.unmodifiableList(new ArrayList<>(sequenceFlows));
        this.gateways = Collections.unmodifiableMap(new HashMap<>(gateways));
        this.events = Collections.unmodifiableMap(new HashMap<>(events));
        this.endEvents = Collections.unmodifiableMap(new HashMap<>(endEvents));
        this.rawXml = rawXml;
        this.candidateStarterGroups = candidateStarterGroups != null
                ? Collections.unmodifiableList(candidateStarterGroups)
                : List.of();
        this.candidateStarterUsers = candidateStarterUsers != null ? Collections.unmodifiableList(candidateStarterUsers)
                : List.of();
        buildFlowGraph();
        classifyBackEdges();
    }

    /** Declares the loop bounds of this definition (set once by the parser). */
    /** Variables declared {@code sensitive: true} (set once by the parser). */
    public ParsedProcessDefinition withSensitiveVariables(Set<String> declared) {
        this.sensitiveVariables = Set.copyOf(declared);
        return this;
    }

    public Set<String> getSensitiveVariables() {
        return sensitiveVariables;
    }

    /** Declares the agent nodes' evidence overrides (set once by the parser). */
    public ParsedProcessDefinition withEvidenceOverrides(Map<String, EvidenceOverride> declared) {
        this.evidenceOverrides = Map.copyOf(declared);
        return this;
    }

    public EvidenceOverride getEvidenceOverride(String activityId) {
        return evidenceOverrides.get(activityId);
    }

    /** Declares the call-process nodes of this definition (set once by the parser). */
    public ParsedProcessDefinition withCallProcesses(Map<String, CallProcessMeta> declared) {
        this.callProcesses = Map.copyOf(declared);
        return this;
    }

    public CallProcessMeta getCallProcess(String activityId) {
        return callProcesses.get(activityId);
    }

    public boolean isCallProcess(String activityId) {
        return callProcesses.containsKey(activityId);
    }

    public Map<String, CallProcessMeta> getCallProcesses() {
        return callProcesses;
    }

    public ParsedProcessDefinition withLoops(Map<String, LoopMeta> declared) {
        this.loops = Map.copyOf(declared);
        return this;
    }

    /** Declares the boundaries of this definition (set once by the parser); their flows are already in the graph. */
    public ParsedProcessDefinition withBoundaries(Collection<BoundaryMeta> declared) {
        Map<String, List<BoundaryMeta>> byActivity = new LinkedHashMap<>();
        for (BoundaryMeta boundary : declared) {
            byActivity.computeIfAbsent(boundary.attachedTo(), key -> new ArrayList<>()).add(boundary);
        }
        byActivity.replaceAll((key, list) -> List.copyOf(list));
        this.boundaries = Map.copyOf(byActivity);
        return this;
    }

    /** Boundaries attached to an activity, in declaration order (code-specific errors before catch-alls). */
    public List<BoundaryMeta> boundariesOf(String activityId) {
        return boundaries.getOrDefault(activityId, List.of());
    }

    public Collection<BoundaryMeta> getBoundaries() {
        return boundaries.values().stream().flatMap(List::stream).toList();
    }

    /** The first boundary of {@code kind} on the activity that catches {@code code} (ERROR) or any (others). */
    public BoundaryMeta boundaryFor(String activityId, BoundaryMeta.Kind kind, String code) {
        for (BoundaryMeta boundary : boundariesOf(activityId)) {
            if (boundary.kind() != kind) continue;
            if (kind == BoundaryMeta.Kind.OUTCOME) {
                if (boundary.code().equals(code)) return boundary;
            } else if (kind != BoundaryMeta.Kind.ERROR || boundary.catches(code)) {
                return boundary;
            }
        }
        return null;
    }

    public BoundaryMeta getBoundary(String activityId, String boundaryId) {
        return boundariesOf(activityId).stream().filter(boundary -> boundary.id().equals(boundaryId))
                .findFirst().orElse(null);
    }

    public Map<String, LoopMeta> getLoops() {
        return loops;
    }

    public LoopMeta getLoop(String headerId) {
        return loops.get(headerId);
    }

    /** True when {@code source -> target} closes a cycle (its target is a loop header). */
    public boolean isBackEdge(String source, String target) {
        return backEdges.contains(edgeKey(source, target));
    }

    /** Every back-edge as {@code [source, target]}, in discovery order. */
    public List<String[]> getBackEdges() {
        return backEdges.stream().map(key -> key.split("\u0000", 2)).toList();
    }

    private static String edgeKey(String source, String target) {
        return source + "\u0000" + target;
    }

    /**
     * Iterative three-colour depth-first search from the start event: an edge
     * into a node still on the current path closes a cycle. O(V+E), so graphs
     * with many converging branches stay linear. Every cycle reachable from the
     * start contains at least one such back-edge.
     */
    private void classifyBackEdges() {
        if (startEventId == null) return;
        Set<String> onPath = new HashSet<>();
        Set<String> finished = new HashSet<>();
        Deque<String> nodes = new ArrayDeque<>();
        Deque<Integer> nextChild = new ArrayDeque<>();
        nodes.push(startEventId);
        nextChild.push(0);
        onPath.add(startEventId);
        while (!nodes.isEmpty()) {
            String node = nodes.peek();
            int index = nextChild.pop();
            List<String> children = flowGraph.getOrDefault(node, List.of());
            if (index < children.size()) {
                nextChild.push(index + 1);
                String child = children.get(index);
                if (onPath.contains(child)) {
                    backEdges.add(edgeKey(node, child));
                } else if (!finished.contains(child)) {
                    nodes.push(child);
                    nextChild.push(0);
                    onPath.add(child);
                }
            } else {
                nodes.pop();
                onPath.remove(node);
                finished.add(node);
            }
        }
    }

    private void buildFlowGraph() {
        for (SequenceFlow flow : sequenceFlows) {
            flowGraph.computeIfAbsent(flow.getSourceRef(), k -> new ArrayList<>()).add(flow.getTargetRef());
            outgoingBySource.computeIfAbsent(flow.getSourceRef(), k -> new ArrayList<>()).add(flow);
            incomingByTarget.computeIfAbsent(flow.getTargetRef(), k -> new ArrayList<>()).add(flow);
        }
        flowGraph.replaceAll((key, value) -> List.copyOf(value));
        outgoingBySource.replaceAll((key, value) -> List.copyOf(value));
        incomingByTarget.replaceAll((key, value) -> List.copyOf(value));
    }

    public String findJoinGateway(String forkGatewayId, GatewayMeta.Type forkGatewayType) {
        Queue<String> queue = new LinkedList<>();
        Set<String> visited = new HashSet<>();

        for (SequenceFlow flow : getOutgoing(forkGatewayId)) {
            queue.add(flow.getTargetRef());
            visited.add(flow.getTargetRef());
        }

        while (!queue.isEmpty()) {
            String currentId = queue.poll();
            GatewayMeta currentGw = gateways.get(currentId);

            if (currentGw != null && currentGw.type() == forkGatewayType && getIncoming(currentId).size() > 1) {
                return currentId;
            }

            for (SequenceFlow outgoingFlow : getOutgoing(currentId)) {
                String nextId = outgoingFlow.getTargetRef();
                if (!visited.contains(nextId)) {
                    queue.add(nextId);
                    visited.add(nextId);
                }
            }
        }

        return null; // No join gateway found
    }

    /**
     * The fork gateway whose structural join is {@code joinGatewayId}: a
     * parallel or inclusive gateway with one incoming flow, of the join's type.
     * Null when no fork closes at that join.
     */
    public String findForkOf(String joinGatewayId) {
        GatewayMeta join = gateways.get(joinGatewayId);
        if (join == null) return null;
        for (Map.Entry<String, GatewayMeta> entry : gateways.entrySet()) {
            String candidate = entry.getKey();
            if (entry.getValue().type() != join.type() || getIncoming(candidate).size() != 1) continue;
            if (joinGatewayId.equals(findJoinGateway(candidate, join.type()))) return candidate;
        }
        return null;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getDocumentation() {
        return documentation;
    }

    public String getStartEventId() {
        return startEventId;
    }

    public Map<String, TaskMeta> getUserTasks() {
        return userTasks;
    }

    public Map<String, ServiceTaskMeta> getServiceTasks() {
        return serviceTasks;
    }

    public Map<String, ScriptTaskMeta> getScriptTasks() {
        return scriptTasks;
    }

    public List<SequenceFlow> getSequenceFlows() {
        return sequenceFlows;
    }

    public Map<String, GatewayMeta> getGateways() {
        return gateways;
    }

    public Map<String, EventMeta> getEvents() {
        return events;
    }

    public String getRawXml() {
        return rawXml;
    }

    public TaskMeta getUserTask(String taskId) {
        return userTasks.get(taskId);
    }

    public ServiceTaskMeta getServiceTask(String taskId) {
        return serviceTasks.get(taskId);
    }

    public ScriptTaskMeta getScriptTask(String taskId) { return scriptTasks.get(taskId); }
    public boolean isScriptTask(String id) { return scriptTasks.containsKey(id); }

    public Map<String, DecisionTableMeta> getDecisionTables() {
        return decisionTables;
    }

    public DecisionTableMeta getDecisionTable(String taskId) {
        return decisionTables.get(taskId);
    }

    public boolean isDecisionTable(String id) {
        return decisionTables.containsKey(id);
    }

    public List<String> getNextActivities(String fromId) {
        return flowGraph.getOrDefault(fromId, Collections.emptyList());
    }

    public String getNextActivity(String fromId) {
        List<String> next = getNextActivities(fromId);
        return next.isEmpty() ? null : next.get(0);
    }

    public List<SequenceFlow> getOutgoingFlows(String sourceId) {
        return sequenceFlows.stream()
                .filter(flow -> flow.getSourceRef().equals(sourceId))
                .collect(Collectors.toList());
    }

    public boolean isEnd(String activityId) {
        return getNextActivity(activityId).isEmpty();
    }

    public Set<String> getAllActivityIds() {
        Set<String> ids = new HashSet<>();
        ids.addAll(userTasks.keySet());
        ids.addAll(serviceTasks.keySet());
        ids.addAll(scriptTasks.keySet());
        ids.addAll(decisionTables.keySet());
        ids.addAll(flowGraph.keySet());
        flowGraph.values().forEach(ids::addAll);
        return ids;
    }

    public boolean isUserTask(String id) {
        return userTasks.containsKey(id);
    }

    public boolean isServiceTask(String id) {
        return serviceTasks.containsKey(id);
    }

    public boolean isGateway(String id) {
        return gateways.containsKey(id);
    }

    public boolean isCatchEvent(String id) {
        return events.containsKey(id);
    }

    public boolean isEndEvent(String id) {
        return endEvents.containsKey(id);
    }

    public boolean isExclusiveGateway(String activityId) {
        GatewayMeta gw = gateways.get(activityId);
        return gw != null && gw.type() == GatewayMeta.Type.EXCLUSIVE;
    }

    public boolean isInclusiveGateway(String activityId) {
        GatewayMeta gw = gateways.get(activityId);
        return gw != null && gw.type() == GatewayMeta.Type.INCLUSIVE;
    }

    public boolean isParallelGateway(String activityId) {
        GatewayMeta gw = gateways.get(activityId);
        return gw != null && gw.type() == GatewayMeta.Type.PARALLEL;
    }

    /**
     * An event gateway is a competing-event wait point: its token registers a
     * wait state per catch child and the first fired child to advance wins,
     * cancelling all sibling wait states in the same transaction.
     */
    public boolean isEventGateway(String activityId) {
        GatewayMeta gw = gateways.get(activityId);
        return gw != null && gw.type() == GatewayMeta.Type.EVENT;
    }

    /** Catch-event children of an event gateway (its outgoing targets). */
    public List<String> getEventGatewayChildren(String gatewayId) {
        return getOutgoing(gatewayId).stream()
                .map(SequenceFlow::getTargetRef)
                .filter(this::isCatchEvent)
                .toList();
    }

    /** The event gateway a catch event belongs to, or null for standalone events. */
    public String getEventGatewayOf(String catchEventId) {
        for (Map.Entry<String, GatewayMeta> entry : gateways.entrySet()) {
            if (entry.getValue().type() != GatewayMeta.Type.EVENT) continue;
            boolean child = getOutgoing(entry.getKey()).stream()
                    .anyMatch(flow -> flow.getTargetRef().equals(catchEventId));
            if (child) return entry.getKey();
        }
        return null;
    }

    /**
     * Number of logical token streams entering a join gateway. Children of the
     * same event gateway count as a single stream: only one competing child
     * ever fires, so an N-child event gateway contributes exactly one token to
     * the join. Without event gateways this equals the incoming flow count.
     */
    public int logicalIncomingCount(String joinId) {
        Set<String> logicalSources = new HashSet<>();
        for (SequenceFlow flow : getIncoming(joinId)) {
            String gateway = getEventGatewayOf(flow.getSourceRef());
            logicalSources.add(gateway != null ? gateway : flow.getSourceRef());
        }
        return logicalSources.size();
    }

    public String getTaskName(String id) {
        TaskMeta meta = userTasks.get(id);
        return meta != null ? meta.getName() : null;
    }

    public String getTaskAssignee(String taskId) {
        TaskMeta meta = userTasks.get(taskId);
        return meta != null ? meta.getAssignee() : null;
    }

    public List<String> getCandidateUsers(String taskId) {
        TaskMeta meta = userTasks.get(taskId);
        return meta != null ? meta.getCandidateUsers() : List.of();
    }

    public List<String> getCandidateGroups(String taskId) {
        TaskMeta meta = userTasks.get(taskId);
        return meta != null ? meta.getCandidateGroups() : List.of();
    }

    public List<String> getCandidateStarterGroups() {
        return candidateStarterGroups;
    }

    public List<String> getCandidateStarterUsers() {
        return candidateStarterUsers;
    }

    public String getActivityName(String id) {
        if (userTasks.containsKey(id)) {
            return userTasks.get(id).getName();
        }
        if (serviceTasks.containsKey(id)) {
            return serviceTasks.get(id).name();
        }
        if (scriptTasks.containsKey(id)) return scriptTasks.get(id).name();
        if (decisionTables.containsKey(id)) return decisionTables.get(id).name();
        if (events.containsKey(id)) {
            return events.get(id).name();
        }
        return null;
    }
}
