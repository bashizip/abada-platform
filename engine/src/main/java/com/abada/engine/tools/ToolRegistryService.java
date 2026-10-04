package com.abada.engine.tools;

import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.ToolBinding;
import com.abada.engine.core.model.ToolPolicy;
import com.abada.engine.parser.AplParser;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.persistence.repository.ProjectResourceRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Resolves APL {@code tools:} references against a project's {@code TOOL_SERVER}
 * resources and freezes the result with the definition version.
 *
 * <p>The engine never connects to a tool server: it only reads the documents
 * people saved, checks them, and hands the frozen bindings to the worker that
 * locks the agent's work.
 */
@Service
public class ToolRegistryService {
    /** A tool reference that does not resolve, or a node that loosens a server's policy. */
    public static final String RESOLUTION_CODE = "ABADA-APL-TOOL-002";

    private static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());
    private static final TypeReference<Map<String, List<ToolBinding>>> BINDINGS = new TypeReference<>() {};

    /** One loaded server document and the resource it came from. */
    public record Server(ToolServerDocument document, ProjectResourceEntity resource) {}

    /** Bindings per agent node id, or the problems that stop the deployment. */
    public record Resolution(Map<String, List<ToolBinding>> bindings, List<BpmnValidationIssue> errors) {
        public boolean ok() {
            return errors.isEmpty();
        }
    }

    private final ProjectResourceRepository resources;
    private final ObjectMapper json;
    private final boolean allowInsecureHttp;
    /** Immutable per deployment, so caching by deployment id is safe (runtime invariant 3). */
    private final Map<String, Map<String, List<ToolBinding>>> byDeployment = new ConcurrentHashMap<>();

    public ToolRegistryService(ProjectResourceRepository resources, ObjectMapper json,
            @Value("${abada.tools.allow-insecure-http:false}") boolean allowInsecureHttp) {
        this.resources = resources;
        this.json = json;
        this.allowInsecureHttp = allowInsecureHttp;
    }

    /**
     * Checks a {@code TOOL_SERVER} document before it is saved: valid against
     * the schema and its rules, and no other tool server in the project uses
     * the same name.
     *
     * @param resourceId the resource being replaced, or null for a new one
     */
    public ToolServerDocument validateForSave(String projectId, String resourceId, byte[] content) {
        ToolServerDocument document = ToolServerDocument.parse(content, allowInsecureHttp);
        for (ProjectResourceEntity other : resources.findByProjectIdAndKindOrderByNameAsc(projectId,
                ProjectResourceEntity.Kind.TOOL_SERVER)) {
            if (Objects.equals(other.getId(), resourceId)) continue;
            String otherName = nameOf(other);
            if (document.name().equals(otherName)) {
                throw new ToolServerDocument.InvalidToolServerException(List.of(new ToolServerDocument.Issue(
                        "/name", "tool server '" + document.name() + "' already exists in this project ("
                                + other.getName() + ")")));
            }
        }
        return document;
    }

    /** The project's tool servers by name. Documents that no longer parse are skipped. */
    public Map<String, Server> servers(String projectId) {
        Map<String, Server> servers = new LinkedHashMap<>();
        for (ProjectResourceEntity resource : resources.findByProjectIdAndKindOrderByNameAsc(projectId,
                ProjectResourceEntity.Kind.TOOL_SERVER)) {
            try {
                ToolServerDocument document = ToolServerDocument.parse(resource.getContent(), allowInsecureHttp);
                servers.putIfAbsent(document.name(), new Server(document, resource));
            } catch (ToolServerDocument.InvalidToolServerException ignored) {
                // Rejected on save; a document saved before a rule tightened simply does not resolve.
            }
        }
        return servers;
    }

    /**
     * Resolves every {@code <server>/<tool>} reference of every agent node in
     * an APL source. Names without a server are advisory (the parser warns)
     * and are not bound.
     */
    public Resolution resolve(String projectId, byte[] aplSource) {
        JsonNode root;
        try {
            root = YAML.readTree(aplSource);
        } catch (IOException exception) {
            return new Resolution(Map.of(), List.of()); // the parser reports unreadable sources
        }
        JsonNode nodes = root == null ? null : root.path("flow").path("nodes");
        if (nodes == null || !nodes.isArray()) return new Resolution(Map.of(), List.of());

        Map<String, Server> servers = null;
        Map<String, List<ToolBinding>> bindings = new LinkedHashMap<>();
        List<BpmnValidationIssue> errors = new ArrayList<>();
        for (int index = 0; index < nodes.size(); index++) {
            JsonNode node = nodes.get(index);
            if (!"agent".equals(node.path("type").asText()) || !node.path("tools").isArray()) continue;
            String nodeId = node.path("id").asText();
            List<ToolBinding> nodeBindings = new ArrayList<>();
            JsonNode tools = node.path("tools");
            for (int position = 0; position < tools.size(); position++) {
                JsonNode entry = tools.get(position);
                String ref = entry.isObject() ? entry.path("ref").asText("") : entry.asText("");
                ref = ref.strip();
                if (!AplParser.isToolRef(ref)) continue;
                String pointer = "/flow/nodes/" + index + "/tools/" + position;
                if (servers == null) servers = servers(projectId);
                String serverName = ref.substring(0, ref.indexOf('/'));
                String toolName = ref.substring(ref.indexOf('/') + 1);
                Server server = servers.get(serverName);
                if (server == null) {
                    errors.add(error(nodeId, pointer, "agent node '" + nodeId + "' uses tool server '"
                            + serverName + "' which this project does not define",
                            "Add a TOOL_SERVER resource named '" + serverName + "' or fix the reference"));
                    continue;
                }
                ToolServerDocument.Tool tool = server.document().tools().get(toolName);
                if (tool == null) {
                    errors.add(error(nodeId, pointer, "agent node '" + nodeId + "' uses tool '" + toolName
                            + "' which tool server '" + serverName + "' does not list",
                            "List the tool in the tool server document with its policy"));
                    continue;
                }
                ToolPolicy policy = tool.policy();
                if (entry.isObject()) {
                    ToolPolicy requested = ToolPolicy.fromWire(entry.path("policy").asText(null));
                    if (requested != null && !requested.atLeastAsStrictAs(tool.policy())) {
                        errors.add(error(nodeId, pointer + "/policy", "agent node '" + nodeId + "' declares tool '"
                                + ref + "' as " + requested.wireName() + " but its server requires "
                                + tool.policy().wireName() + "; a node may tighten a policy, never loosen it",
                                "Use " + tool.policy().wireName() + " or a stricter policy"));
                        continue;
                    }
                    if (requested != null) policy = requested;
                }
                String idempotency = tool.idempotency();
                if (policy != ToolPolicy.READ && idempotency == null) {
                    // A read tool tightened to a write: it was never keyed, so a crash must not resend it.
                    idempotency = "none";
                }
                nodeBindings.add(new ToolBinding(serverName, toolName, policy, idempotency, tool.approvers(),
                        server.document().url(), server.document().transport(), server.document().credential(),
                        server.resource().getId(), server.resource().getEntityVersion()));
            }
            if (!nodeBindings.isEmpty()) bindings.put(nodeId, List.copyOf(nodeBindings));
        }
        return new Resolution(Map.copyOf(bindings), List.copyOf(errors));
    }

    /** Serializes resolved bindings for {@code process_definitions.tool_bindings}; null when there are none. */
    public String toJson(Map<String, List<ToolBinding>> bindings) {
        if (bindings == null || bindings.isEmpty()) return null;
        try {
            return json.writeValueAsString(new java.util.TreeMap<>(bindings));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot serialize tool bindings", exception);
        }
    }

    /** The frozen bindings of one deployed definition version, keyed by agent node id. */
    public Map<String, List<ToolBinding>> bindingsFor(String deploymentId, String storedJson) {
        if (storedJson == null || storedJson.isBlank()) return Map.of();
        return byDeployment.computeIfAbsent(deploymentId, ignored -> {
            try {
                return Map.copyOf(json.readValue(storedJson, BINDINGS));
            } catch (JsonProcessingException exception) {
                throw new IllegalStateException("Stored tool bindings of deployment " + deploymentId
                        + " cannot be read", exception);
            }
        });
    }

    private String nameOf(ProjectResourceEntity resource) {
        try {
            return ToolServerDocument.parse(resource.getContent(), true).name();
        } catch (ToolServerDocument.InvalidToolServerException exception) {
            return null;
        }
    }

    private static BpmnValidationIssue error(String nodeId, String pointer, String message, String resolution) {
        return new BpmnValidationIssue(RESOLUTION_CODE, ValidationSeverity.ERROR, message, null, nodeId,
                AplParser.LANGUAGE_VERSION, null, resolution, pointer);
    }
}
