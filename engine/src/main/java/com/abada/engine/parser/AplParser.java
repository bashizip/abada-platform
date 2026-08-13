package com.abada.engine.parser;

import com.abada.engine.bpmn.compatibility.BpmnParseResult;
import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.CompatibilityMapping;
import com.abada.engine.bpmn.compatibility.CompatibilityProfiles;
import com.abada.engine.bpmn.compatibility.CompatibilityReport;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.DecisionTableMeta;
import com.abada.engine.core.model.AgentWorkDescriptor;
import com.abada.engine.core.model.GatewayMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.core.model.SequenceFlow;
import com.abada.engine.core.model.ScriptTaskMeta;
import com.abada.engine.core.model.ServiceTaskMeta;
import com.abada.engine.core.model.TaskMeta;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import org.springframework.stereotype.Component;
import java.util.Deque;
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
            "gemini-3.6-flash,deepseek/deepseek-v4-flash-free,gpt-5-mini";

    public static final int MAX_DEPLOYMENT_BYTES = 10 * 1024 * 1024;

    private static final Set<String> SUPPORTED_TYPES = Set.of(
            "webhook", "end", "agent", "engine-task", "decision-table", "script",
            "approval-gate", "condition", "inclusive", "parallel");

    private static final String APL_VALIDATION_CODE = "ABADA-APL-VALIDATION-001";

    private final YAMLMapper yamlMapper = new YAMLMapper();

    private final Set<String> allowedAgentModels;

    public AplParser() {
        this(DEFAULT_ALLOWED_AGENT_MODELS);
    }

    /**
     * @param allowedAgentModelsCsv comma-separated model ids an agent node may
     *        declare; a blank value disables the check.
     */
    public AplParser(String allowedAgentModelsCsv) {
        this.allowedAgentModels = allowedAgentModelsCsv == null || allowedAgentModelsCsv.isBlank()
                ? Set.of()
                : Arrays.stream(allowedAgentModelsCsv.split(","))
                        .map(String::strip).filter(value -> !value.isBlank())
                        .collect(Collectors.toUnmodifiableSet());
    }

    private static BpmnValidationException validation(String message) {
        return BpmnValidationException.single(new BpmnValidationIssue(
                APL_VALIDATION_CODE, ValidationSeverity.ERROR, message,
                null, null, "abada.io/v1", null, null));
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
        if (source == null || source.length == 0) {
            throw validation("APL source is empty");
        }
        if (source.length > MAX_DEPLOYMENT_BYTES) {
            throw validation("APL deployment exceeds the 10 MiB input limit");
        }
        String rawSource = new String(source, StandardCharsets.UTF_8);
        JsonNode root;
        try {
            root = yamlMapper.readTree(rawSource);
        } catch (IOException exception) {
            throw validation("APL source is not valid YAML: " + exception.getMessage());
        }
        if (!LANGUAGE_VERSION.equals(root.path("version").asText())) {
            throw validation("Unsupported APL language version '" + root.path("version").asText()
                    + "' — only '" + LANGUAGE_VERSION + "' is supported");
        }

        String name = root.path("metadata").path("name").asText(null);
        if (name == null || name.isBlank()) {
            throw validation("metadata.name is required");
        }
        String declaredKey = root.path("metadata").path("key").asText(null);
        String processId = declaredKey == null || declaredKey.isBlank()
                ? name.replaceAll("[^a-zA-Z0-9]", "_").toLowerCase(Locale.ROOT)
                : declaredKey;
        if (processId.isBlank()) {
            throw validation("metadata.name must contain at least one alphanumeric character");
        }
        if (declaredKey != null && !declaredKey.isBlank()
                && !processId.matches("[a-z][a-z0-9_-]{0,127}")) {
            throw validation("metadata.key must match [a-z][a-z0-9_-]{0,127}");
        }

        JsonNode flow = root.path("flow");
        if (!flow.isObject()) {
            throw validation("flow (with entry and nodes) is required");
        }
        String entry = flow.path("entry").asText(null);
        if (entry == null || entry.isBlank()) {
            throw validation("flow.entry is required");
        }
        JsonNode rawNodes = flow.path("nodes");
        if (!rawNodes.isArray() || rawNodes.isEmpty()) {
            throw validation("flow.nodes must declare at least one node");
        }

        Map<String, JsonNode> nodesById = new LinkedHashMap<>();
        for (JsonNode node : rawNodes) {
            String nodeId = node.path("id").asText();
            if (nodeId == null || nodeId.isBlank()) {
                throw validation("every flow node must declare a non-empty id");
            }
            if (nodesById.put(nodeId, node) != null) {
                throw validation("duplicate node id '" + nodeId + "'");
            }
        }
        if (!nodesById.containsKey(entry)) {
            throw validation("flow.entry '" + entry + "' does not match any node id");
        }
        if (!"webhook".equals(nodesById.get(entry).path("type").asText())) {
            throw validation("flow.entry '" + entry + "' must reference a webhook node");
        }
        for (Map.Entry<String, JsonNode> candidate : nodesById.entrySet()) {
            if (!candidate.getKey().equals(entry) && "webhook".equals(candidate.getValue().path("type").asText())) {
                throw validation("exactly one webhook node is allowed; '" + candidate.getKey() + "' is a second start");
            }
        }

        Map<String, String> nextByNode = new LinkedHashMap<>();
        List<SequenceFlow> flows = new ArrayList<>();
        Set<String> flowIds = new HashSet<>();
        Map<String, TaskMeta> userTasks = new LinkedHashMap<>();
        Map<String, ServiceTaskMeta> serviceTasks = new LinkedHashMap<>();
        Map<String, ScriptTaskMeta> scriptTasks = new LinkedHashMap<>();
        Map<String, DecisionTableMeta> decisionTables = new LinkedHashMap<>();
        Map<String, GatewayMeta> gateways = new LinkedHashMap<>();
        Map<String, Object> endEvents = new LinkedHashMap<>();

        for (JsonNode node : rawNodes) {
            String nodeId = node.path("id").asText();
            String type = node.path("type").asText();
            String nodeName = node.hasNonNull("description") ? node.path("description").asText() : null;

            switch (type) {
                case "webhook" -> { /* start; routed via `next` */ }
                case "end" -> {
                    if (node.hasNonNull("next")) {
                        throw validation("end node '" + nodeId + "' must not declare a 'next' node");
                    }
                    endEvents.put(nodeId, nodeId);
                }
                case "agent" -> serviceTasks.put(nodeId,
                        new ServiceTaskMeta(nodeId, nodeName, null, AGENT_EXTERNAL_TOPIC,
                                parseAgentWork(node, nodeId)));
                case "engine-task" -> {
                    String topic = node.path("service").asText(null);
                    if (topic == null || topic.isBlank()) {
                        throw validation("engine-task node '" + nodeId + "' requires the 'service' topic");
                    }
                    serviceTasks.put(nodeId, new ServiceTaskMeta(nodeId, nodeName, null, topic));
                }
                case "decision-table" -> {
                    String decisionKey = node.path("decisionKey").asText("DMN_" + nodeId.toUpperCase(Locale.ROOT));
                    String hitPolicy = node.path("hitPolicy").asText("FIRST").toUpperCase(Locale.ROOT);
                    if (!Set.of("FIRST", "UNIQUE", "COLLECT").contains(hitPolicy)) {
                        throw validation("decision-table node '" + nodeId + "' declares unsupported hitPolicy '"
                                + node.path("hitPolicy").asText() + "'; expected FIRST, UNIQUE or COLLECT");
                    }
                    decisionTables.put(nodeId, new DecisionTableMeta(nodeId, nodeName, decisionKey,
                            hitPolicy, parseInputs(node, nodeId), parseRules(node, nodeId)));
                }
                case "script" -> {
                    String script = node.path("script").asText(null);
                    if (script == null || script.isBlank()) {
                        throw validation("script node '" + nodeId + "' requires a non-empty 'script' body");
                    }
                    String format = node.path("format").asText("javascript");
                    if (format.isBlank()) {
                        throw validation("script node '" + nodeId + "' must not declare an empty 'format'");
                    }
                    scriptTasks.put(nodeId, new ScriptTaskMeta(nodeId, nodeName, format, script));
                }
                case "approval-gate" -> {
                    JsonNode assignees = node.path("assignees");
                    if (!assignees.isArray() || assignees.isEmpty()) {
                        throw validation("approval-gate node '" + nodeId + "' requires a non-empty 'assignees' list");
                    }
                    List<String> groups = new ArrayList<>();
                    for (JsonNode assignee : assignees) {
                        String group = assignee.asText(null);
                        if (group == null || group.isBlank()) {
                            throw validation("approval-gate node '" + nodeId + "' has an empty assignee");
                        }
                        groups.add(group);
                    }
                    userTasks.put(nodeId,
                            new TaskMeta(nodeId, nodeName, null, List.of(), groups, null, null, null, null, null));
                }
                case "condition" -> {
                    if (node.hasNonNull("next")) {
                        throw validation("condition node '" + nodeId + "' routes via 'rules', not 'next'");
                    }
                    JsonNode rules = node.path("rules");
                    if (!rules.isArray() || rules.isEmpty()) {
                        throw validation("condition node '" + nodeId + "' requires a non-empty rules list");
                    }
                    List<SequenceFlow> conditionFlows = new ArrayList<>();
                    String defaultFlowId = null;
                    for (JsonNode rule : rules) {
                        boolean isElseRule = rule.path("else").asBoolean(false)
                                || rule.path("else").isTextual();
                        String target = rule.path("then").asText(rule.path("else").asText(null));
                        if (target == null || target.isBlank() || "true".equals(target)) {
                            throw validation("condition node '" + nodeId + "' rule must declare a 'then' target");
                        }
                        if (!nodesById.containsKey(target)) {
                            throw validation("condition node '" + nodeId + "' routes to undeclared node '" + target + "'");
                        }
                        String condition = rule.path("if").asText(null);
                        if (!isElseRule && (condition == null || condition.isBlank())) {
                            throw validation("condition node '" + nodeId
                                    + "' rule must declare an 'if' condition unless it is the else rule");
                        }
                        String flowId = flowIdFor(nodeId, target, flowIds);
                        if (isElseRule) {
                            if (defaultFlowId != null) {
                                throw validation("condition node '" + nodeId
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
                            throw validation("inclusive fork node '" + nodeId
                                    + "' must not combine 'rules' and 'next'");
                        }
                        if (!rules.isArray() || rules.isEmpty()) {
                            throw validation("inclusive fork node '" + nodeId
                                    + "' requires a non-empty rules list");
                        }
                        String defaultFlowId = null;
                        for (JsonNode rule : rules) {
                            boolean isElseRule = rule.path("else").asBoolean(false)
                                    || rule.path("else").isTextual();
                            String target = rule.path("then").asText(rule.path("else").asText(null));
                            if (target == null || target.isBlank() || "true".equals(target)) {
                                throw validation("inclusive fork node '" + nodeId
                                        + "' rule must declare a 'then' target");
                            }
                            if (!nodesById.containsKey(target)) {
                                throw validation("inclusive fork node '" + nodeId
                                        + "' routes to undeclared node '" + target + "'");
                            }
                            String condition = rule.path("if").asText(null);
                            if (!isElseRule && (condition == null || condition.isBlank())) {
                                throw validation("inclusive fork node '" + nodeId
                                        + "' rule must declare an 'if' condition unless it is the else rule");
                            }
                            String flowId = flowIdFor(nodeId, target, flowIds);
                            if (isElseRule) {
                                if (defaultFlowId != null) {
                                    throw validation("inclusive fork node '" + nodeId
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
                            throw validation("inclusive node '" + nodeId
                                    + "' must declare either 'rules' (fork) or 'next' (join)");
                        }
                        gateways.put(nodeId, new GatewayMeta(nodeId, GatewayMeta.Type.INCLUSIVE, null));
                    }
                }
                case "parallel" -> {
                    JsonNode branches = node.path("branches");
                    if (!branches.isMissingNode() && !branches.isNull()) {
                        if (node.hasNonNull("next")) {
                            throw validation("parallel node '" + nodeId
                                    + "' must not combine 'branches' and 'next'");
                        }
                        if (!branches.isArray() || branches.size() < 2) {
                            throw validation("parallel node '" + nodeId
                                    + "' 'branches' must declare at least two distinct target nodes");
                        }
                        Set<String> branchTargets = new HashSet<>();
                        for (JsonNode branch : branches) {
                            String target = branch.asText(null);
                            if (target == null || target.isBlank()) {
                                throw validation("parallel node '" + nodeId + "' has an empty branch target");
                            }
                            if (!nodesById.containsKey(target)) {
                                throw validation("parallel node '" + nodeId
                                        + "' 'branches' target '" + target + "' is not a declared node");
                            }
                            if (!branchTargets.add(target)) {
                                throw validation("parallel node '" + nodeId
                                        + "' lists duplicate branch target '" + target + "'");
                            }
                            flows.add(new SequenceFlow(flowIdFor(nodeId, target, flowIds),
                                    nodeId, target, null, null, false));
                        }
                    }
                    gateways.put(nodeId, new GatewayMeta(nodeId, GatewayMeta.Type.PARALLEL, null));
                }
                default -> throw validation("unsupported node type '" + type + "' for node '" + nodeId
                        + "'; supported: " + String.join(", ", SUPPORTED_TYPES));
            }

            if (node.hasNonNull("next")) {
                String next = node.path("next").asText();
                if (next == null || next.isBlank()) {
                    throw validation("node '" + nodeId + "' declares an empty 'next' target");
                }
                if (!nodesById.containsKey(next)) {
                    throw validation("flow target '" + next + "' of node '" + nodeId + "' is not a declared node");
                }
                nextByNode.put(nodeId, next);
                flows.add(new SequenceFlow(flowIdFor(nodeId, next, flowIds), nodeId, next, null, null, false));
            }
        }

        rejectCycles(entry, flows);

        String definitionId = processId;
        return new BpmnParseResult(
                new ParsedProcessDefinition(definitionId, name, null, entry,
                        userTasks, serviceTasks, scriptTasks, decisionTables,
                        flows, gateways, Map.of(), endEvents,
                        rawSource, null, null),
                new CompatibilityReport(Set.of(CompatibilityProfiles.ABADA_NATIVE),
                        List.of(new CompatibilityMapping("abada.io/v1 APL source",
                                "Abada canonical process model", definitionId,
                                "Native APL definitions compile directly into the executable graph "
                                        + "without an XML round-trip.")),
                        List.of()),
                List.of(CompatibilityProfiles.ABADA_NATIVE),
                Set.of("abada.io/v1"));
    }

    private AgentWorkDescriptor parseAgentWork(JsonNode node, String nodeId) {
        String profile = node.path("profile").asText("abada.agent/v1");
        if (!"abada.agent/v1".equals(profile)) {
            throw validation("agent node '" + nodeId + "' declares unsupported profile '" + profile + "'");
        }
        double confidence = node.path("confidence_threshold").asDouble(0.0);
        if (confidence < 0 || confidence > 100) {
            throw validation("agent node '" + nodeId + "' confidence_threshold must be between 0 and 100");
        }
        double temperature = node.path("temperature").asDouble(0.2);
        if (temperature < 0 || temperature > 2) {
            throw validation("agent node '" + nodeId + "' temperature must be between 0 and 2");
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
            throw validation("agent node '" + nodeId + "' inputs must be a mapping");
        }
        Map<String, Object> outputSchema = Map.of();
        if (node.path("output_schema").isObject()) {
            outputSchema = yamlMapper.convertValue(node.path("output_schema"), Map.class);
        }
        List<String> tools = new ArrayList<>();
        JsonNode rawTools = node.path("tools");
        if (rawTools.isArray()) rawTools.forEach(tool -> tools.add(tool.asText()));
        else if (!rawTools.isMissingNode() && !rawTools.isNull()) {
            throw validation("agent node '" + nodeId + "' tools must be a list");
        }
        String model = node.path("model").asText(null);
        if (model != null && !model.isBlank() && !allowedAgentModels.isEmpty()
                && !allowedAgentModels.contains(model.strip())) {
            throw validation("agent node '" + nodeId + "' declares model '" + model.strip()
                    + "' which is not on the allowed model list ("
                    + String.join(", ", allowedAgentModels) + ")");
        }
        return new AgentWorkDescriptor(profile, model,
                node.path("prompt").asText(""), inputs,
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
                    throw validation("decision-table node '" + nodeId
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
            throw validation("decision-table node '" + nodeId + "' declares invalid inputs");
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
                throw validation("decision-table node '" + nodeId
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
            throw validation("decision-table node '" + nodeId + "' rule 'then' must be an output map");
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

    /** Native APL definitions are strictly acyclic: the engine never loops. */
    private static void rejectCycles(String entry, List<SequenceFlow> flows) {
        Map<String, List<String>> adjacency = new LinkedHashMap<>();
        for (SequenceFlow flow : flows) {
            adjacency.computeIfAbsent(flow.getSourceRef(), key -> new ArrayList<>()).add(flow.getTargetRef());
        }
        Set<String> onPath = new HashSet<>();
        Deque<Object[]> work = new ArrayDeque<>();
        work.push(new Object[]{entry, null, null});
        while (!work.isEmpty()) {
            Object[] frame = work.peek();
            String nodeId = (String) frame[0];
            if (frame[2] == null) {
                if (!onPath.add(nodeId)) {
                    throw validation("cyclic flow detected at node '" + nodeId + "'");
                }
                frame[2] = Boolean.TRUE;
                List<String> next = adjacency.get(nodeId);
                if (next != null) {
                    for (int index = next.size() - 1; index >= 0; index--) {
                        work.push(new Object[]{next.get(index), nodeId, null});
                    }
                }
            } else {
                onPath.remove(nodeId);
                work.pop();
            }
        }
    }
}
