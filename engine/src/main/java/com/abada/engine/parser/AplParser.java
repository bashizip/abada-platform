package com.abada.engine.parser;

import com.abada.engine.bpmn.compatibility.BpmnParseResult;
import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.CompatibilityMapping;
import com.abada.engine.bpmn.compatibility.CompatibilityProfiles;
import com.abada.engine.bpmn.compatibility.CompatibilityReport;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.DecisionTableMeta;
import com.abada.engine.core.model.LoopMeta;
import com.abada.engine.core.model.AgentWorkDescriptor;
import com.abada.engine.core.model.GatewayMeta;
import com.abada.engine.core.model.EventMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.core.model.SequenceFlow;
import com.abada.engine.core.model.ScriptTaskMeta;
import com.abada.engine.core.model.ServiceTaskMeta;
import com.abada.engine.core.model.TaskMeta;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import org.springframework.stereotype.Component;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Runtime graph compiler for native {@code abada.io/v1} APL YAML documents.
 *
 * <p>The APL document is compiled directly into the same executable
 * {@link ParsedProcessDefinition} graph the BPMN parser produces — no XML
 * round-trip, no intermediate document. Node types map 1:1 onto the engine
 * runtime model:
 *
 * <ul>
 *   <li>{@code webhook}        → start event (the {@code flow.entry} node)</li>
 *   <li>{@code end}             → end event</li>
 *   <li>{@code agent}           → external service task on topic {@code abada:agent}</li>
 *   <li>{@code engine-task}     → external service task on the declared service topic</li>
 *   <li>{@code decision-table}  → native deterministic decision table
 *       (FIRST | UNIQUE | COLLECT, ordered {@code when}/{@code otherwise}
 *       rules with typed {@code then} outputs);</li>
 *   <li>{@code script}          → server-side script task executed inside the
 *       workflow transaction (the APL form of an embedded Java delegate)</li>
 *   <li>{@code approval-gate}   → user task with candidate-group assignment</li>
 *   <li>{@code condition}       → exclusive gateway; {@code if} rules become
 *       conditional flows and the {@code else} rule (or the last rule when no
 *       {@code else} is declared) becomes the default flow</li>
 *   <li>{@code inclusive}       → inclusive gateway: a fork when it declares
 *       {@code rules} (every matching {@code if} rule fires; an explicit
 *       {@code else} rule is the only default — zero matches without one fail
 *       loudly), a join when several upstream nodes converge on it and it
 *       continues via {@code next}</li>
 *   <li>{@code parallel}        → parallel gateway: a fork when it declares
 *       {@code branches} (one token per branch), a join when several upstream
 *       nodes converge on it and it continues via {@code next}</li>
 *   <li>{@code event-gateway}   → event-based gateway: an inline {@code events}
 *       list of ≥2 competing catch children (message-catch, timer or signal);
 *       the first child to fire advances the instance and the engine cancels
 *       every sibling wait state in the same transaction</li>
 *   <li>{@code message-catch}   → message catch event: durable subscription by
 *       message name, correlated against the instance variable
 *       {@code correlationKey} (identical to BPMN message semantics)</li>
 *   <li>{@code timer}            → duration timer catch event: durable ISO-8601
 *       job scheduled for {@code duration}</li>
 *   <li>{@code signal}           → signal catch event: durable broadcast
 *       subscription by signal name</li>
 * </ul>
 *
 * <p>Unsupported or ambiguous constructs are rejected at deployment: the
 * engine never guesses a graph from a partial APL document.
 */
@Component
public final class AplParser {

    /** The only supported APL language version. */
    public static final String LANGUAGE_VERSION = "abada.io/v1";

    /** External-task topic emitted for {@code agent} nodes (worker contract). */
    public static final String AGENT_EXTERNAL_TOPIC = "abada:agent";

    /** Default allow-list of agent LLM models deployable without extra configuration. */
    public static final String DEFAULT_ALLOWED_AGENT_MODELS =
            "gemini-3.6-flash,gemini-3.7-flash,gemini-3.8-flash,deepseek/deepseek-v4-flash-free,gpt-5-mini";

    public static final int MAX_DEPLOYMENT_BYTES = 10 * 1024 * 1024;

    /**
     * Canonical node types recognised by the APL parser.
     * {@code human-input} is the canonical type for human tasks; {@code approval-gate}
     * is retained as a deprecated alias for backward compatibility.
     */
    public static final Set<String> SUPPORTED_TYPES = Set.of(
             "webhook", "end", "agent", "engine-task", "decision-table", "script",
             "approval-gate", "condition", "inclusive", "parallel", "event-gateway",
             "message-catch", "timer", "signal", "human-input");

    private static final String APL_VALIDATION_CODE = "ABADA-APL-VALIDATION-001";

    private final YAMLMapper yamlMapper = new YAMLMapper();

    private final Set<String> allowedAgentModels;
    private final boolean enforceDeploymentPolicy;

    /** Agent models this parser accepts; empty when the check is disabled. */
    public Set<String> allowedAgentModels() {
        return allowedAgentModels;
    }

    public AplParser() {
        this(DEFAULT_ALLOWED_AGENT_MODELS);
    }

    /**
     * @param allowedAgentModelsCsv comma-separated model ids an agent node may
     *        declare; a blank value disables the check.
     */
    @org.springframework.beans.factory.annotation.Autowired
    public AplParser(@org.springframework.beans.factory.annotation.Value(
            "${abada.agent.allowed-models:" + DEFAULT_ALLOWED_AGENT_MODELS + "}") String allowedAgentModelsCsv) {
        this(allowedAgentModelsCsv, true);
    }

    /**
     * @param enforceDeploymentPolicy when true (deployment and authoring), every
     *        expression must compile as CEL and scripts/delegates must satisfy the
     *        operator {@link com.abada.engine.expression.ExecutionPolicy}. Reloading
     *        already-deployed definitions passes false.
     */
    public AplParser(String allowedAgentModelsCsv, boolean enforceDeploymentPolicy) {
        this.enforceDeploymentPolicy = enforceDeploymentPolicy;
        this.allowedAgentModels = allowedAgentModelsCsv == null || allowedAgentModelsCsv.isBlank()
                ? Set.of()
                : Arrays.stream(allowedAgentModelsCsv.split(","))
                        .map(String::strip).filter(value -> !value.isBlank())
                        .collect(Collectors.toUnmodifiableSet());
    }

    private static BpmnValidationException validation(String message) {
        return validation(null, message);
    }

    /**
     * @param field JSON Pointer of the offending value: absolute ({@code /flow/entry})
     *        or relative to the current node ({@code temperature}); null for the node itself.
     */
    private static BpmnValidationException validation(String field, String message) {
        return BpmnValidationException.single(new BpmnValidationIssue(
                APL_VALIDATION_CODE, ValidationSeverity.ERROR, message,
                null, null, LANGUAGE_VERSION, null, null, field));
    }

    /** Attaches the node id and anchors relative paths under the node's pointer. */
    private static List<BpmnValidationIssue> locate(BpmnValidationException exception, String nodeId,
            String nodePointer) {
        List<BpmnValidationIssue> located = new ArrayList<>();
        for (BpmnValidationIssue issue : exception.getIssues()) {
            String path = issue.path();
            if (path == null) path = nodePointer;
            else if (!path.startsWith("/")) path = nodePointer + "/" + path;
            located.add(new BpmnValidationIssue(issue.code(), issue.severity(), issue.message(),
                    issue.processDefinitionId(), issue.elementId() == null ? nodeId : issue.elementId(),
                    issue.namespace(), issue.sourceLocation(), issue.suggestedResolution(), path));
        }
        return located;
    }

    /**
     * Content sniffing shared by all load paths: a definition is native APL
     * when its first meaningful line declares the {@code abada.io/v1} language
     * version (everything the Studio emits); anything starting with {@code <}
     * is treated as BPMN XML.
     */
    public static boolean isAplSource(byte[] source) {
        if (source == null || source.length == 0) return false;
        String text = new String(source, StandardCharsets.UTF_8).trim();
        if (text.isEmpty() || text.startsWith("<")) return false;
        String first = text.lines().map(String::trim)
                .filter(line -> !line.isEmpty() && !line.startsWith("#"))
                .findFirst().orElse("");
        return "version: abada.io/v1".equals(first);
    }

    public ParsedProcessDefinition parse(byte[] source) {
        return parseDetailed(source).definition();
    }

    public BpmnParseResult parseDetailed(byte[] source) {
        List<BpmnValidationIssue> warnings = new ArrayList<>();
        try {
            return compile(source, warnings);
        } catch (BpmnValidationException exception) {
            // Errors first, then every warning gathered before the failure.
            List<BpmnValidationIssue> issues = new ArrayList<>(exception.getIssues());
            issues.addAll(warnings);
            throw new BpmnValidationException(issues);
        }
    }

    private BpmnParseResult compile(byte[] source, List<BpmnValidationIssue> warnings) {
        if (source == null || source.length == 0) {
            throw validation("/", "APL source is empty");
        }
        if (source.length > MAX_DEPLOYMENT_BYTES) {
            throw validation("/", "APL deployment exceeds the 10 MiB input limit");
        }
        String rawSource = new String(source, StandardCharsets.UTF_8);
        JsonNode root;
        try {
            root = yamlMapper.readTree(rawSource);
        } catch (IOException exception) {
            throw validation("/", "APL source is not valid YAML: " + exception.getMessage());
        }
        if (root == null || !root.isObject()) {
            throw validation("/", "APL source must be a YAML mapping");
        }
        if (!LANGUAGE_VERSION.equals(root.path("version").asText())) {
            throw validation("/version", "Unsupported APL language version '" + root.path("version").asText()
                    + "' — only '" + LANGUAGE_VERSION + "' is supported");
        }
        warnings.addAll(AplSchema.instance().validate(root));

        String name = root.path("metadata").path("name").asText(null);
        if (name == null || name.isBlank()) {
            throw validation("/metadata/name", "metadata.name is required");
        }
        String declaredKey = root.path("metadata").path("key").asText(null);
        String processId = declaredKey == null || declaredKey.isBlank()
                ? name.replaceAll("[^a-zA-Z0-9]", "_").toLowerCase(Locale.ROOT)
                : declaredKey;
        if (processId.isBlank()) {
            throw validation("/metadata/name", "metadata.name must contain at least one alphanumeric character");
        }
        if (declaredKey != null && !declaredKey.isBlank()
                && !processId.matches("[a-z][a-z0-9_-]{0,127}")) {
            throw validation("/metadata/key", "metadata.key must match [a-z][a-z0-9_-]{0,127}");
        }

        JsonNode flow = root.path("flow");
        if (!flow.isObject()) {
            throw validation("/flow", "flow (with entry and nodes) is required");
        }
        String entry = flow.path("entry").asText(null);
        if (entry == null || entry.isBlank()) {
            throw validation("/flow/entry", "flow.entry is required");
        }
        JsonNode rawNodes = flow.path("nodes");
        if (!rawNodes.isArray() || rawNodes.isEmpty()) {
            throw validation("/flow/nodes", "flow.nodes must declare at least one node");
        }

        List<BpmnValidationIssue> errors = new ArrayList<>();
        errors.addAll(AplVariables.declarationErrors(root));
        Map<String, JsonNode> nodesById = new LinkedHashMap<>();
        Map<String, String> pointerById = new LinkedHashMap<>();
        for (int index = 0; index < rawNodes.size(); index++) {
            JsonNode node = rawNodes.get(index);
            String pointer = "/flow/nodes/" + index;
            String nodeId = node.path("id").asText();
            if (nodeId == null || nodeId.isBlank()) {
                errors.add(issueAt(pointer + "/id", null, "every flow node must declare a non-empty id"));
            } else if (nodesById.containsKey(nodeId)) {
                errors.add(issueAt(pointer + "/id", nodeId, "duplicate node id '" + nodeId + "'"));
            } else if (nodeId.endsWith(OUTCOME_GATEWAY_SUFFIX)) {
                errors.add(issueAt(pointer + "/id", nodeId,
                        "node id '" + nodeId + "' uses the reserved suffix '" + OUTCOME_GATEWAY_SUFFIX + "'"));
            } else {
                nodesById.put(nodeId, node);
                pointerById.put(nodeId, pointer);
            }
        }
        if (!nodesById.containsKey(entry)) {
            errors.add(issueAt("/flow/entry", null, "flow.entry '" + entry + "' does not match any node id"));
        } else if (!"webhook".equals(nodesById.get(entry).path("type").asText())) {
            errors.add(issueAt("/flow/entry", entry, "flow.entry '" + entry + "' must reference a webhook node"));
        }
        for (Map.Entry<String, JsonNode> candidate : nodesById.entrySet()) {
            if (!candidate.getKey().equals(entry) && "webhook".equals(candidate.getValue().path("type").asText())) {
                errors.add(issueAt(pointerById.get(candidate.getKey()) + "/type", candidate.getKey(),
                        "exactly one webhook node is allowed; '" + candidate.getKey() + "' is a second start"));
            }
        }

        Map<String, String> nextByNode = new LinkedHashMap<>();
        List<SequenceFlow> flows = new ArrayList<>();
        Set<String> flowIds = new HashSet<>();
        Map<String, TaskMeta> userTasks = new LinkedHashMap<>();
        Map<String, ServiceTaskMeta> serviceTasks = new LinkedHashMap<>();
        Map<String, ScriptTaskMeta> scriptTasks = new LinkedHashMap<>();
        Map<String, DecisionTableMeta> decisionTables = new LinkedHashMap<>();
        Map<String, EventMeta> events = new LinkedHashMap<>();
        Map<String, GatewayMeta> gateways = new LinkedHashMap<>();
        Map<String, Object> endEvents = new LinkedHashMap<>();
        Map<String, LoopMeta> loops = new LinkedHashMap<>();

        // Each node is compiled independently so one invalid node never hides another's errors.
        for (Map.Entry<String, JsonNode> compiled : nodesById.entrySet()) {
            String nodeId = compiled.getKey();
            JsonNode node = compiled.getValue();
            String type = node.path("type").asText();
            String nodeName = node.hasNonNull("description") ? node.path("description").asText() : null;
            try {
                switch (type) {
                    case "webhook" -> { /* start; routed via `next` */ }
                    case "end" -> {
                        if (node.hasNonNull("next")) {
                            throw validation("next", "end node '" + nodeId + "' must not declare a 'next' node");
                        }
                        endEvents.put(nodeId, nodeId);
                    }
                    case "agent" -> serviceTasks.put(nodeId,
                            new ServiceTaskMeta(nodeId, nodeName, null, AGENT_EXTERNAL_TOPIC,
                                    parseAgentWork(node, nodeId)));
                    case "engine-task" -> {
                        String topic = node.path("service").asText(null);
                        if (topic == null || topic.isBlank()) {
                            throw validation("service", "engine-task node '" + nodeId + "' requires the 'service' topic");
                        }
                        serviceTasks.put(nodeId, new ServiceTaskMeta(nodeId, nodeName, null, topic));
                    }
                    case "decision-table" -> {
                        String decisionKey = node.path("decisionKey").asText("DMN_" + nodeId.toUpperCase(Locale.ROOT));
                        String hitPolicy = node.path("hitPolicy").asText("FIRST").toUpperCase(Locale.ROOT);
                        if (!Set.of("FIRST", "UNIQUE", "COLLECT").contains(hitPolicy)) {
                            throw validation("hitPolicy", "decision-table node '" + nodeId + "' declares unsupported hitPolicy '"
                                    + node.path("hitPolicy").asText() + "'; expected FIRST, UNIQUE or COLLECT");
                        }
                        decisionTables.put(nodeId, new DecisionTableMeta(nodeId, nodeName, decisionKey,
                                hitPolicy, parseInputs(node, nodeId), parseRules(node, nodeId)));
                    }
                    case "script" -> {
                        String script = node.path("script").asText(null);
                        if (script == null || script.isBlank()) {
                            throw validation("script", "script node '" + nodeId + "' requires a non-empty 'script' body");
                        }
                        String format = node.path("format").asText("javascript");
                        if (format.isBlank()) {
                            throw validation("format", "script node '" + nodeId + "' must not declare an empty 'format'");
                        }
                        scriptTasks.put(nodeId, new ScriptTaskMeta(nodeId, nodeName, format, script));
                    }
                    case "approval-gate" -> {
                        JsonNode assignees = node.path("assignees");
                        if (!assignees.isArray() || assignees.isEmpty()) {
                            throw validation("assignees", "approval-gate node '" + nodeId + "' requires a non-empty 'assignees' list");
                        }
                        List<String> groups = new ArrayList<>();
                        for (JsonNode assignee : assignees) {
                            String group = assignee.asText(null);
                            if (group == null || group.isBlank()) {
                                throw validation("assignees", "approval-gate node '" + nodeId + "' has an empty assignee");
                            }
                            groups.add(group);
                        }
                        userTasks.put(nodeId,
                                new TaskMeta(nodeId, nodeName, null, List.of(), groups, null, null, null, null, null));
                    }
                    case "condition" -> {
                        if (node.hasNonNull("next")) {
                            throw validation("next", "condition node '" + nodeId + "' routes via 'rules', not 'next'");
                        }
                        JsonNode rules = node.path("rules");
                        if (!rules.isArray() || rules.isEmpty()) {
                            throw validation("rules", "condition node '" + nodeId + "' requires a non-empty rules list");
                        }
                        List<SequenceFlow> conditionFlows = new ArrayList<>();
                        String defaultFlowId = null;
                        for (JsonNode rule : rules) {
                            boolean isElseRule = rule.path("else").asBoolean(false)
                                    || rule.path("else").isTextual();
                            String target = rule.path("then").asText(rule.path("else").asText(null));
                            if (target == null || target.isBlank() || "true".equals(target)) {
                                throw validation("rules", "condition node '" + nodeId + "' rule must declare a 'then' target");
                            }
                            if (!nodesById.containsKey(target)) {
                                throw validation("rules", "condition node '" + nodeId + "' routes to undeclared node '" + target + "'");
                            }
                            String condition = rule.path("if").asText(null);
                            if (!isElseRule && (condition == null || condition.isBlank())) {
                                throw validation("rules", "condition node '" + nodeId
                                        + "' rule must declare an 'if' condition unless it is the else rule");
                            }
                            String flowId = flowIdFor(nodeId, target, flowIds);
                            if (isElseRule) {
                                if (defaultFlowId != null) {
                                    throw validation("rules", "condition node '" + nodeId
                                            + "' declares more than one else/default rule");
                                }
                                defaultFlowId = flowId;
                            }
                            SequenceFlow conditionFlow = new SequenceFlow(flowId, nodeId, target, null, condition,
                                    isElseRule);
                            conditionFlows.add(conditionFlow);
                            flows.add(conditionFlow);
                        }
                        if (defaultFlowId == null && !conditionFlows.isEmpty()) {
                            SequenceFlow lastFlow = conditionFlows.get(conditionFlows.size() - 1);
                            defaultFlowId = lastFlow.getId();
                            flows.remove(lastFlow);
                            flows.add(new SequenceFlow(lastFlow.getId(), lastFlow.getSourceRef(),
                                    lastFlow.getTargetRef(), null, lastFlow.getConditionExpression(), true));
                        }
                        gateways.put(nodeId, new GatewayMeta(nodeId, GatewayMeta.Type.EXCLUSIVE, defaultFlowId));
                    }
                    case "inclusive" -> {
                        JsonNode rules = node.path("rules");
                        if (!rules.isMissingNode()) {
                            if (node.hasNonNull("next")) {
                                throw validation("next", "inclusive fork node '" + nodeId
                                        + "' must not combine 'rules' and 'next'");
                            }
                            if (!rules.isArray() || rules.isEmpty()) {
                                throw validation("rules", "inclusive fork node '" + nodeId
                                        + "' requires a non-empty rules list");
                            }
                            String defaultFlowId = null;
                            for (JsonNode rule : rules) {
                                boolean isElseRule = rule.path("else").asBoolean(false)
                                        || rule.path("else").isTextual();
                                String target = rule.path("then").asText(rule.path("else").asText(null));
                                if (target == null || target.isBlank() || "true".equals(target)) {
                                    throw validation("rules", "inclusive fork node '" + nodeId
                                            + "' rule must declare a 'then' target");
                                }
                                if (!nodesById.containsKey(target)) {
                                    throw validation("rules", "inclusive fork node '" + nodeId
                                            + "' routes to undeclared node '" + target + "'");
                                }
                                String condition = rule.path("if").asText(null);
                                if (!isElseRule && (condition == null || condition.isBlank())) {
                                    throw validation("rules", "inclusive fork node '" + nodeId
                                            + "' rule must declare an 'if' condition unless it is the else rule");
                                }
                                String flowId = flowIdFor(nodeId, target, flowIds);
                                if (isElseRule) {
                                    if (defaultFlowId != null) {
                                        throw validation("rules", "inclusive fork node '" + nodeId
                                                + "' declares more than one else/default rule");
                                    }
                                    defaultFlowId = flowId;
                                }
                                flows.add(new SequenceFlow(flowId, nodeId, target, null, condition, isElseRule));
                            }
                            gateways.put(nodeId,
                                    new GatewayMeta(nodeId, GatewayMeta.Type.INCLUSIVE, defaultFlowId));
                        } else {
                            if (!node.hasNonNull("next")) {
                                throw validation("next", "inclusive node '" + nodeId
                                        + "' must declare either 'rules' (fork) or 'next' (join)");
                            }
                            gateways.put(nodeId, new GatewayMeta(nodeId, GatewayMeta.Type.INCLUSIVE, null));
                        }
                    }
                    case "parallel" -> {
                        JsonNode branches = node.path("branches");
                        if (!branches.isMissingNode() && !branches.isNull()) {
                            if (node.hasNonNull("next")) {
                                throw validation("next", "parallel node '" + nodeId
                                        + "' must not combine 'branches' and 'next'");
                            }
                            if (!branches.isArray() || branches.size() < 2) {
                                throw validation("branches", "parallel node '" + nodeId
                                        + "' 'branches' must declare at least two distinct target nodes");
                            }
                            Set<String> branchTargets = new HashSet<>();
                            for (JsonNode branch : branches) {
                                String target = branch.asText(null);
                                if (target == null || target.isBlank()) {
                                    throw validation("branches", "parallel node '" + nodeId + "' has an empty branch target");
                                }
                                if (!nodesById.containsKey(target)) {
                                    throw validation("branches", "parallel node '" + nodeId
                                            + "' 'branches' target '" + target + "' is not a declared node");
                                }
                                if (!branchTargets.add(target)) {
                                    throw validation("branches", "parallel node '" + nodeId
                                            + "' lists duplicate branch target '" + target + "'");
                                }
                                flows.add(new SequenceFlow(flowIdFor(nodeId, target, flowIds),
                                        nodeId, target, null, null, false));
                            }
                        }
                        gateways.put(nodeId, new GatewayMeta(nodeId, GatewayMeta.Type.PARALLEL, null));
                    }
                    case "event-gateway" -> {
                        if (node.hasNonNull("next")) {
                            throw validation("events", "event-gateway node '" + nodeId
                                    + "' routes via its 'events', not 'next'");
                        }
                        JsonNode eventNodes = node.path("events");
                        if (!eventNodes.isArray() || eventNodes.size() < 2) {
                            throw validation("events", "event-gateway node '" + nodeId
                                    + "' requires at least two 'events' catch children");
                        }
                        Set<String> competingNames = new HashSet<>();
                        for (int index = 0; index < eventNodes.size(); index++) {
                            JsonNode child = eventNodes.get(index);
                            String childType = child.path("type").asText(null);
                            String childId = nodeId + "_e" + index;
                            String childNext = child.path("next").asText(null);
                            if (childNext == null || childNext.isBlank()) {
                                throw validation("events", "event '" + (childType == null ? "?" : childType)
                                        + "' in event-gateway '" + nodeId + "' requires a 'next' target");
                            }
                            if (!nodesById.containsKey(childNext)) {
                                throw validation("events", "event in event-gateway '" + nodeId
                                        + "' routes to undeclared node '" + childNext + "'");
                            }
                            EventMeta childEvent = switch (childType) {
                                case "message-catch" -> {
                                    String message = child.path("message").asText(null);
                                    if (message == null || message.isBlank()) {
                                        throw validation("events", "event-gateway '" + nodeId
                                                + "' message-catch event requires a non-empty 'message' name");
                                    }
                                    if (!competingNames.add("MESSAGE:" + message)) {
                                        throw validation("events", "event-gateway '" + nodeId
                                                + "' declares duplicate competing message '" + message + "'");
                                    }
                                    yield new EventMeta(childId, child.path("description").asText(null),
                                            EventMeta.EventType.MESSAGE, message);
                                }
                                case "timer" -> {
                                    String duration = child.path("duration").asText(null);
                                    if (duration == null || duration.isBlank()) {
                                        throw validation("events", "event-gateway '" + nodeId
                                                + "' timer event requires a non-empty 'duration'");
                                    }
                                    try {
                                        Duration.parse(duration);
                                    } catch (Exception exception) {
                                        throw validation("events", "event-gateway '" + nodeId
                                                + "' timer event declares invalid ISO-8601 duration '" + duration + "'");
                                    }
                                    yield new EventMeta(childId, child.path("description").asText(null),
                                            EventMeta.EventType.TIMER, duration);
                                }
                                case "signal" -> {
                                    String signal = child.path("signal").asText(null);
                                    if (signal == null || signal.isBlank()) {
                                        throw validation("events", "event-gateway '" + nodeId
                                                + "' signal event requires a non-empty 'signal' name");
                                    }
                                    if (!competingNames.add("SIGNAL:" + signal)) {
                                        throw validation("events", "event-gateway '" + nodeId
                                                + "' declares duplicate competing signal '" + signal + "'");
                                    }
                                    yield new EventMeta(childId, child.path("description").asText(null),
                                            EventMeta.EventType.SIGNAL, signal);
                                }
                                default -> throw validation("events", "event-gateway '" + nodeId
                                        + "' declares unsupported event type '" + childType
                                        + "'; expected message-catch, timer or signal");
                            };
                            events.put(childId, childEvent);
                            flows.add(new SequenceFlow(flowIdFor(nodeId, childId, flowIds),
                                    nodeId, childId, null, null, false));
                            flows.add(new SequenceFlow(flowIdFor(childId, childNext, flowIds),
                                    childId, childNext, null, null, false));
                        }
                        gateways.put(nodeId, new GatewayMeta(nodeId, GatewayMeta.Type.EVENT, null));
                    }
                    case "message-catch" -> {
                        String message = node.path("message").asText(null);
                        if (message == null || message.isBlank()) {
                            throw validation("message", "message-catch node '" + nodeId + "' requires a non-empty 'message' name");
                        }
                        events.put(nodeId, new EventMeta(nodeId, nodeName, EventMeta.EventType.MESSAGE, message));
                    }
                    case "timer" -> {
                        String duration = node.path("duration").asText(null);
                        if (duration == null || duration.isBlank()) {
                            throw validation("duration", "timer node '" + nodeId + "' requires a non-empty 'duration'");
                        }
                        try {
                            Duration.parse(duration);
                        } catch (Exception exception) {
                            throw validation("duration", "timer node '" + nodeId
                                    + "' declares invalid ISO-8601 duration '" + duration + "'");
                        }
                        events.put(nodeId, new EventMeta(nodeId, nodeName, EventMeta.EventType.TIMER, duration));
                    }
                    case "signal" -> {
                        String signal = node.path("signal").asText(null);
                        if (signal == null || signal.isBlank()) {
                            throw validation("signal", "signal node '" + nodeId + "' requires a non-empty 'signal' name");
                        }
                        events.put(nodeId, new EventMeta(nodeId, nodeName, EventMeta.EventType.SIGNAL, signal));
                    }
                    case "human-input" -> {
                        // Canonical APL field is `formKey`; `formId` remains a
                        // deprecated alias so existing documents keep deploying.
                        String formKey = textField(node, "formKey", "formId");
                        JsonNode assignees = node.path("assignees");
                        if (!assignees.isArray() || assignees.isEmpty()) {
                            throw validation("assignees", "human-input node '" + nodeId + "' requires a non-empty 'assignees' list");
                        }
                        List<String> groups = new ArrayList<>();
                        for (JsonNode assignee : assignees) {
                            String group = assignee.asText(null);
                            if (group == null || group.isBlank()) {
                                throw validation("assignees", "human-input node '" + nodeId + "' has an empty assignee");
                            }
                            groups.add(group);
                        }
                        // Parse optional fields
                        JsonNode slaHoursNode = node.path("slaHours");
                        Long slaHours = slaHoursNode.isNumber() ? slaHoursNode.asLong() : null;
                        JsonNode requireDoubleSignOffNode = node.path("requireDoubleSignOff");
                        Boolean requireDoubleSignOff = requireDoubleSignOffNode.isBoolean() ? requireDoubleSignOffNode.asBoolean() : null;
                        userTasks.put(nodeId,
                                new TaskMeta(nodeId, nodeName, null, List.of(), groups, formKey, null, null, null, null));
                    }
                    default -> throw validation("type", "unsupported node type '" + type + "' for node '" + nodeId
                            + "'; supported: " + String.join(", ", SUPPORTED_TYPES));
                }
                if (node.has("loop")) {
                    loops.put(nodeId, parseLoop(node, nodeId, type, nodesById));
                }
            } catch (BpmnValidationException exception) {
                errors.addAll(locate(exception, nodeId, pointerById.get(nodeId)));
            }
            try {
                if (node.hasNonNull("next")) {
                    String next = node.path("next").asText();
                    if (next == null || next.isBlank()) {
                        throw validation("next", "node '" + nodeId + "' declares an empty 'next' target");
                    }
                    if (!nodesById.containsKey(next)) {
                        throw validation("next", "flow target '" + next + "' of node '" + nodeId + "' is not a declared node");
                    }
                    nextByNode.put(nodeId, next);
                    flows.add(new SequenceFlow(flowIdFor(nodeId, next, flowIds), nodeId, next, null, null, false));
                }
            } catch (BpmnValidationException exception) {
                errors.addAll(locate(exception, nodeId, pointerById.get(nodeId)));
            }
        }

        if (errors.isEmpty()) {
            addOutcomeRoutes(nodesById, pointerById, flows, flowIds, gateways, errors);
        }
        if (!errors.isEmpty()) throw new BpmnValidationException(errors);

        String definitionId = processId;
        ParsedProcessDefinition definition = new ParsedProcessDefinition(definitionId, name, null, entry,
                userTasks, serviceTasks, scriptTasks, decisionTables,
                flows, gateways, events, endEvents,
                rawSource, null, null).withLoops(loops);
        if (enforceDeploymentPolicy) {
            // Every cycle must be bounded. Checked on deployment only, like the
            // execution policy, so reloading stored definitions never changes.
            List<BpmnValidationIssue> loopIssues = relocate(
                    LoopRules.check(definition, APL_VALIDATION_CODE, LANGUAGE_VERSION), pointerById);
            List<BpmnValidationIssue> loopErrors = loopIssues.stream()
                    .filter(issue -> issue.severity() == ValidationSeverity.ERROR).toList();
            if (!loopErrors.isEmpty()) throw new BpmnValidationException(loopErrors);
            loopIssues.stream().filter(issue -> issue.severity() != ValidationSeverity.ERROR).forEach(warnings::add);
            try {
                com.abada.engine.expression.DefinitionPolicyValidator.validate(definition, APL_VALIDATION_CODE,
                        LANGUAGE_VERSION);
            } catch (BpmnValidationException exception) {
                throw new BpmnValidationException(relocate(exception.getIssues(), pointerById));
            }
        }
        warnings.addAll(AplVariables.analyze(root, definition, pointerById));
        return new BpmnParseResult(
                definition,
                new CompatibilityReport(Set.of(CompatibilityProfiles.ABADA_NATIVE),
                        List.of(new CompatibilityMapping("abada.io/v1 APL source",
                                "Abada canonical process model", definitionId,
                                "Native APL definitions compile directly into the executable graph "
                                        + "without an XML round-trip.")),
                        List.copyOf(warnings)),
                List.of(CompatibilityProfiles.ABADA_NATIVE),
                Set.of(LANGUAGE_VERSION));
    }

    private static BpmnValidationIssue issueAt(String path, String elementId, String message) {
        return new BpmnValidationIssue(APL_VALIDATION_CODE, ValidationSeverity.ERROR, message,
                null, elementId, LANGUAGE_VERSION, null, null, path);
    }

    /** Anchors issues raised against the compiled graph (by element id) to their APL node. */
    private static List<BpmnValidationIssue> relocate(List<BpmnValidationIssue> issues,
            Map<String, String> pointerById) {
        List<BpmnValidationIssue> located = new ArrayList<>();
        for (BpmnValidationIssue issue : issues) {
            String elementId = issue.elementId();
            String owner = elementId == null ? null : elementId.endsWith(OUTCOME_GATEWAY_SUFFIX)
                    ? elementId.substring(0, elementId.length() - OUTCOME_GATEWAY_SUFFIX.length())
                    : elementId.replaceAll("_e\\d+$", "");
            String pointer = pointerById.containsKey(elementId) ? pointerById.get(elementId)
                    : owner == null ? null : pointerById.get(owner);
            located.add(issue.path() != null || pointer == null ? issue : issue.withLocation(elementId, pointer));
        }
        return located;
    }

    /** {@code loop: { max_iterations, on_exhausted }} on the node a cycle returns to. */
    private static LoopMeta parseLoop(JsonNode node, String nodeId, String type, Map<String, JsonNode> nodesById) {
        if ("webhook".equals(type) || "end".equals(type)) {
            throw validation("loop", type + " node '" + nodeId + "' cannot be a loop step");
        }
        JsonNode loop = node.path("loop");
        if (!loop.isObject()) {
            throw validation("loop", "node '" + nodeId + "' loop must be a mapping with max_iterations");
        }
        JsonNode max = loop.path("max_iterations");
        if (!max.canConvertToInt() || !max.isIntegralNumber() || max.asInt() < LoopMeta.MIN_ITERATIONS
                || max.asInt() > LoopMeta.MAX_ITERATIONS) {
            throw validation("loop", "node '" + nodeId + "' loop.max_iterations must be an integer between "
                    + LoopMeta.MIN_ITERATIONS + " and " + LoopMeta.MAX_ITERATIONS);
        }
        String onExhausted = loop.hasNonNull("on_exhausted") ? loop.path("on_exhausted").asText() : null;
        if (onExhausted != null && !nodesById.containsKey(onExhausted)) {
            throw validation("loop", "node '" + nodeId + "' loop.on_exhausted target '" + onExhausted
                    + "' is not a declared node");
        }
        return new LoopMeta(nodeId, max.asInt(), onExhausted);
    }

    private AgentWorkDescriptor parseAgentWork(JsonNode node, String nodeId) {
        String profile = node.path("profile").asText("abada.agent/v1");
        if (!"abada.agent/v1".equals(profile)) {
            throw validation("profile", "agent node '" + nodeId + "' declares unsupported profile '" + profile + "'");
        }
        double confidence = node.path("confidence_threshold").asDouble(0.0);
        if (confidence < 0 || confidence > 100) {
            throw validation("confidence_threshold", "agent node '" + nodeId + "' confidence_threshold must be between 0 and 100");
        }
        double temperature = node.path("temperature").asDouble(0.2);
        if (temperature < 0 || temperature > 2) {
            throw validation("temperature", "agent node '" + nodeId + "' temperature must be between 0 and 2");
        }
        int maxTokens = node.path("max_tokens").asInt(2048);
        long timeoutMs = node.path("timeout_ms").asLong(60_000L);
        int maxAttempts = node.path("max_attempts").asInt(3);
        long retryBackoffMs = node.path("retry_backoff_ms").asLong(2_000L);
        if (maxTokens < 1 || maxTokens > 1_000_000 || timeoutMs < 1 || timeoutMs > 3_600_000
                || maxAttempts < 1 || maxAttempts > 20 || retryBackoffMs < 0 || retryBackoffMs > 3_600_000) {
            throw validation("agent node '" + nodeId + "' declares invalid execution limits");
        }
        Map<String, String> inputs = new LinkedHashMap<>();
        JsonNode rawInputs = node.path("inputs");
        if (rawInputs.isObject()) {
            rawInputs.fields().forEachRemaining(entry -> inputs.put(entry.getKey(), entry.getValue().asText()));
        } else if (!rawInputs.isMissingNode() && !rawInputs.isNull()) {
            throw validation("inputs", "agent node '" + nodeId + "' inputs must be a mapping");
        }
        String prompt = node.path("prompt").asText("");
        Set<String> references = promptReferences(prompt, nodeId);
        if (inputs.isEmpty()) {
            // Default-deny: an agent receives only the data its prompt names.
            references.forEach(path -> inputs.put(path, "${" + path + "}"));
        } else {
            for (String path : references) {
                boolean covered = inputs.keySet().stream()
                        .anyMatch(name -> path.equals(name) || path.startsWith(name + "."));
                if (!covered) {
                    throw validation("prompt", "agent node '" + nodeId + "' prompt references '${" + path
                            + "}' which is not a declared input; add it to 'inputs' or remove 'inputs' to derive them");
                }
            }
        }
        Map<String, Object> outputSchema = Map.of();
        if (node.path("output_schema").isObject()) {
            outputSchema = yamlMapper.convertValue(node.path("output_schema"), Map.class);
        }
        if (!outputSchema.isEmpty()) {
            String problem = com.abada.engine.core.agent.AgentOutputValidator.schemaProblem(outputSchema);
            if (problem != null) {
                throw validation("output_schema", "agent node '" + nodeId + "' output_schema is not a valid JSON Schema: " + problem);
            }
        }
        List<String> tools = new ArrayList<>();
        JsonNode rawTools = node.path("tools");
        if (rawTools.isArray()) rawTools.forEach(tool -> tools.add(tool.asText()));
        else if (!rawTools.isMissingNode() && !rawTools.isNull()) {
            throw validation("tools", "agent node '" + nodeId + "' tools must be a list");
        }
        String model = node.path("model").asText(null);
        if (model != null && !model.isBlank() && !allowedAgentModels.isEmpty()
                && !allowedAgentModels.contains(model.strip())) {
            throw validation("model", "agent node '" + nodeId + "' declares model '" + model.strip()
                    + "' which is not on the allowed model list ("
                    + String.join(", ", allowedAgentModels) + ")");
        }
        return new AgentWorkDescriptor(profile, model,
                prompt, inputs,
                node.path("result_variable").asText(nodeId + "_result"), outputSchema, tools,
                confidence, temperature, maxTokens, timeoutMs, maxAttempts, retryBackoffMs);
    }

    private static List<DecisionTableMeta.DecisionTableInput> parseInputs(JsonNode node, String nodeId) {
        JsonNode inputs = node.path("inputs");
        List<DecisionTableMeta.DecisionTableInput> result = new ArrayList<>();
        Set<String> names = new HashSet<>();
        if (inputs.isArray()) {
            for (JsonNode input : inputs) {
                String name = input.path("name").asText(null);
                if (name == null || name.isBlank() || !names.add(name)) {
                    throw validation("inputs", "decision-table node '" + nodeId
                            + "' has a missing or duplicate input name");
                }
                String expr = input.path("expr").asText(null);
                result.add(new DecisionTableMeta.DecisionTableInput(name,
                        expr == null || expr.isBlank() ? null : expr));
            }
        } else if (inputs.isObject()) {
            inputs.fields().forEachRemaining(entry ->
                    result.add(new DecisionTableMeta.DecisionTableInput(entry.getKey(), entry.getValue().asText())));
        } else if (!inputs.isMissingNode() && !inputs.isNull()) {
            throw validation("inputs", "decision-table node '" + nodeId + "' declares invalid inputs");
        }
        return result;
    }

    private static List<DecisionTableMeta.DecisionTableRule> parseRules(JsonNode node, String nodeId) {
        JsonNode rules = node.path("rules");
        List<DecisionTableMeta.DecisionTableRule> result = new ArrayList<>();
        for (JsonNode rule : rules) {
            boolean otherwise = false;
            Map<String, Object> outputs = new LinkedHashMap<>();
            JsonNode otherwiseNode = rule.path("otherwise");
            if (otherwiseNode.isObject()) {
                otherwise = true;
                outputs = readOutputs(otherwiseNode.path("then").isMissingNode()
                        ? otherwiseNode : otherwiseNode.path("then"), nodeId);
            } else if (otherwiseNode.asBoolean(false)) {
                otherwise = true;
                if (rule.has("then")) {
                    outputs = readOutputs(rule.path("then"), nodeId);
                }
            } else if (rule.has("then")) {
                outputs = readOutputs(rule.path("then"), nodeId);
            }
            String when = rule.path("when").asText(null);
            if (when == null && !otherwise) {
                throw validation("rules", "decision-table node '" + nodeId
                        + "' rule must declare 'when' or 'otherwise: true'");
            }
            result.add(new DecisionTableMeta.DecisionTableRule(
                    when == null || when.isBlank() ? null : when, otherwise, outputs));
        }
        return result;
    }

    private static Map<String, Object> readOutputs(JsonNode outputsNode, String nodeId) {
        Map<String, Object> outputs = new LinkedHashMap<>();
        if (!outputsNode.isObject()) {
            throw validation("rules", "decision-table node '" + nodeId + "' rule 'then' must be an output map");
        }
        outputsNode.fields().forEachRemaining(entry -> outputs.put(entry.getKey(), scalar(entry.getValue())));
        return outputs;
    }

    private static Object scalar(JsonNode value) {
        if (value == null || value.isNull()) return null;
        if (value.isBoolean()) return value.asBoolean();
        if (value.isIntegralNumber()) return value.asLong();
        if (value.isFloatingPointNumber()) return value.asDouble();
        return value.asText();
    }

    private static String flowIdFor(String sourceId, String targetId, Set<String> used) {
        String base = "Flow_" + sourceId + "_" + targetId;
        String candidate = base;
        for (int suffix = 1; used.contains(candidate); suffix++) {
            candidate = base + "_" + suffix;
        }
        used.add(candidate);
        return candidate;
    }

    /** Reserved suffix of the synthetic gateway that routes agent/engine-task outcomes. */
    public static final String OUTCOME_GATEWAY_SUFFIX = "__outcome";
    public static final String OUTCOME_OK = "OK";
    public static final String OUTCOME_LOW_CONFIDENCE = "LOW_CONFIDENCE";
    public static final String OUTCOME_INVALID_OUTPUT = "INVALID_OUTPUT";
    public static final String OUTCOME_ERROR = "ERROR";

    private static final java.util.regex.Pattern PROMPT_REFERENCE =
            java.util.regex.Pattern.compile("\\$\\{([^}]*)}");
    private static final java.util.regex.Pattern VARIABLE_PATH =
            java.util.regex.Pattern.compile("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*");

    /** Id of the synthetic exclusive gateway placed after a node that declares outcome routes. */
    public static String outcomeGatewayId(String nodeId) {
        return nodeId + OUTCOME_GATEWAY_SUFFIX;
    }

    /** Process variable holding a routed node's outcome (OK, LOW_CONFIDENCE, INVALID_OUTPUT, ERROR). */
    public static String outcomeVariable(String nodeId) {
        return nodeId.replaceAll("[^A-Za-z0-9_]", "_") + "_outcome";
    }

    /** Process variable holding the BPMN error code reported for a routed node. */
    public static String errorCodeVariable(String nodeId) {
        return nodeId.replaceAll("[^A-Za-z0-9_]", "_") + "_error_code";
    }

    /** Process variable holding how many times a loop step has been entered in the current pass (1-based). */
    public static String iterationVariable(String nodeId) {
        return nodeId.replaceAll("[^A-Za-z0-9_]", "_") + "_iteration";
    }

    /** Process variable holding (truncated) raw output rejected by the agent output contract. */
    public static String rawOutputVariable(String nodeId) {
        return nodeId.replaceAll("[^A-Za-z0-9_]", "_") + "_raw_output";
    }

    private static Set<String> promptReferences(String prompt, String nodeId) {
        Set<String> references = new java.util.LinkedHashSet<>();
        java.util.regex.Matcher matcher = PROMPT_REFERENCE.matcher(prompt == null ? "" : prompt);
        while (matcher.find()) {
            String path = matcher.group(1).strip();
            if (!VARIABLE_PATH.matcher(path).matches()) {
                throw validation("prompt", "agent node '" + nodeId + "' prompt placeholder '${" + matcher.group(1)
                        + "}' must be a variable path such as ${lead.companySize}");
            }
            references.add(path);
        }
        return references;
    }

    /**
     * Compiles {@code on_low_confidence}, {@code on_invalid_output} (agent) and
     * {@code on_error} (agent, engine-task) into a synthetic exclusive gateway
     * after the node. Its conditional flows test the engine-written outcome
     * variables; its default flow is the node's {@code next}.
     */
    private static void addOutcomeRoutes(Map<String, JsonNode> nodesById, Map<String, String> pointerById,
            List<SequenceFlow> flows, Set<String> flowIds, Map<String, GatewayMeta> gateways,
            List<BpmnValidationIssue> errors) {
        for (Map.Entry<String, JsonNode> entry : nodesById.entrySet()) {
            try {
                addOutcomeRoute(entry.getKey(), entry.getValue(), nodesById, flows, flowIds, gateways);
            } catch (BpmnValidationException exception) {
                errors.addAll(locate(exception, entry.getKey(), pointerById.get(entry.getKey())));
            }
        }
    }

    private static void addOutcomeRoute(String nodeId, JsonNode node, Map<String, JsonNode> nodesById,
            List<SequenceFlow> flows, Set<String> flowIds, Map<String, GatewayMeta> gateways) {
        {
            String type = node.path("type").asText();
            boolean agent = "agent".equals(type);
            boolean routable = agent || "engine-task".equals(type);
            List<String[]> routes = new ArrayList<>();
            String outcome = outcomeVariable(nodeId);
            if (agent) {
                addRoute(routes, nodesById, nodeId, node.path("on_invalid_output"), "on_invalid_output",
                        "${" + outcome + " == '" + OUTCOME_INVALID_OUTPUT + "'}");
                addRoute(routes, nodesById, nodeId, node.path("on_low_confidence"), "on_low_confidence",
                        "${" + outcome + " == '" + OUTCOME_LOW_CONFIDENCE + "'}");
            } else {
                for (String field : List.of("on_invalid_output", "on_low_confidence")) {
                    if (node.has(field)) {
                        throw validation(field, "node '" + nodeId + "' declares '" + field + "', which only agent nodes support");
                    }
                }
            }
            JsonNode onError = node.path("on_error");
            if (!onError.isMissingNode() && !onError.isNull()) {
                if (!routable) {
                    throw validation("on_error", "node '" + nodeId + "' declares 'on_error', which only agent and engine-task nodes support");
                }
                String errorCode = errorCodeVariable(nodeId);
                if (onError.isTextual()) {
                    addRoute(routes, nodesById, nodeId, onError, "on_error", "${" + outcome + " == '" + OUTCOME_ERROR + "'}");
                } else if (onError.isArray()) {
                    List<String[]> catchAll = new ArrayList<>();
                    for (JsonNode rule : onError) {
                        String code = rule.path("code").asText(null);
                        if (code != null && !code.matches("[A-Za-z0-9_.:-]{1,128}")) {
                            throw validation("on_error", "node '" + nodeId + "' on_error code '" + code + "' is not a valid error code");
                        }
                        String condition = code == null
                                ? "${" + outcome + " == '" + OUTCOME_ERROR + "'}"
                                : "${" + outcome + " == '" + OUTCOME_ERROR + "' && " + errorCode + " == '" + code + "'}";
                        addRoute(code == null ? catchAll : routes, nodesById, nodeId, rule.path("then"), "on_error.then",
                                condition);
                    }
                    if (catchAll.size() > 1) {
                        throw validation("on_error", "node '" + nodeId + "' declares more than one on_error rule without a code");
                    }
                    routes.addAll(catchAll);
                } else {
                    throw validation("on_error", "node '" + nodeId + "' on_error must be a node id or a list of {code, then}");
                }
            }
            if (routes.isEmpty()) return;

            SequenceFlow normal = flows.stream().filter(flow -> flow.getSourceRef().equals(nodeId)).findFirst()
                    .orElseThrow(() -> validation("node '" + nodeId + "' declares outcome routes but no 'next'"));
            String gatewayId = outcomeGatewayId(nodeId);
            flows.remove(normal);
            flows.add(new SequenceFlow(flowIdFor(nodeId, gatewayId, flowIds), nodeId, gatewayId, null, null, false));
            for (String[] route : routes) {
                flows.add(new SequenceFlow(flowIdFor(gatewayId, route[0], flowIds), gatewayId, route[0], null,
                        route[1], false));
            }
            String defaultFlowId = flowIdFor(gatewayId, normal.getTargetRef(), flowIds);
            flows.add(new SequenceFlow(defaultFlowId, gatewayId, normal.getTargetRef(), null, null, true));
            gateways.put(gatewayId, new GatewayMeta(gatewayId, GatewayMeta.Type.EXCLUSIVE, defaultFlowId));
        }
    }

    private static void addRoute(List<String[]> routes, Map<String, JsonNode> nodesById, String nodeId,
            JsonNode target, String field, String condition) {
        if (target == null || target.isMissingNode() || target.isNull()) return;
        String targetId = target.asText(null);
        if (targetId == null || targetId.isBlank()) {
            throw validation(field.split("\\.")[0], "node '" + nodeId + "' declares an empty '" + field + "' target");
        }
        if (!nodesById.containsKey(targetId)) {
            throw validation(field.split("\\.")[0], "node '" + nodeId + "' " + field + " target '" + targetId
                    + "' is not a declared node");
        }
        routes.add(new String[]{targetId, condition});
    }

    /** Reads a text field by its canonical name, falling back to a legacy alias. */
    private static String textField(JsonNode node, String canonical, String legacy) {
        JsonNode value = node.path(canonical);
        if (value.isMissingNode() || value.isNull()) {
            value = node.path(legacy);
        }
        return value.isMissingNode() || value.isNull() ? null : value.asText(null);
    }
}
