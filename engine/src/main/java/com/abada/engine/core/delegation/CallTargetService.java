package com.abada.engine.core.delegation;

import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.CallProcessMeta;
import com.abada.engine.core.model.DefinitionSchema;
import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.parser.AplParser;
import com.abada.engine.persistence.PersistenceService;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

/**
 * Pins the child version of every {@code call-process} node when its parent is
 * deployed: the latest deployment of the called key in the same project. The
 * result is stored with the parent version, so redeploying a child never
 * changes what a running parent calls; redeploying the parent picks it up.
 */
@Service
public class CallTargetService {
    /** A call to a process the project does not have, or inputs the child does not declare. */
    public static final String CALL_CODE = "ABADA-APL-CALL-001";

    private static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());
    private static final TypeReference<Map<String, CallTarget>> TARGETS = new TypeReference<>() {};

    /**
     * The pinned child of one call node. {@code declaredTypes} are the child's
     * {@code metadata.variables} (name to type), empty when it declares none.
     */
    public record CallTarget(String processKey, String deploymentId, int version, Map<String, String> declaredTypes) {
        public CallTarget {
            declaredTypes = declaredTypes == null ? Map.of() : Map.copyOf(declaredTypes);
        }
    }

    public record Resolution(Map<String, CallTarget> targets, List<BpmnValidationIssue> errors) {
        public boolean ok() {
            return errors.isEmpty();
        }
    }

    private final PersistenceService persistence;
    private final ObjectMapper json;
    /** Immutable per deployment, so caching by deployment id is safe (runtime invariant 3). */
    private final Map<String, Map<String, CallTarget>> byDeployment = new ConcurrentHashMap<>();

    public CallTargetService(PersistenceService persistence, ObjectMapper json) {
        this.persistence = persistence;
        this.json = json;
    }

    public Resolution resolve(String projectId, ParsedProcessDefinition definition, byte[] source) {
        if (definition.getCallProcesses().isEmpty()) return new Resolution(Map.of(), List.of());
        Map<String, String> pointers = nodePointers(source);
        Map<String, CallTarget> targets = new LinkedHashMap<>();
        List<BpmnValidationIssue> errors = new ArrayList<>();
        for (CallProcessMeta call : definition.getCallProcesses().values()) {
            String pointer = pointers.getOrDefault(call.id(), "/flow/nodes");
            ProcessDefinitionEntity child = persistence.findProcessDefinitionByProjectAndId(projectId,
                    call.processKey());
            if (child == null) {
                errors.add(error(call.id(), pointer + "/process", "call-process node '" + call.id()
                        + "' calls '" + call.processKey() + "', which is not deployed in this project",
                        "Deploy '" + call.processKey() + "' first, then deploy this process"));
                continue;
            }
            Map<String, String> declared = declaredTypes(child);
            if (!declared.isEmpty()) {
                for (String input : call.inputs().keySet()) {
                    if (!declared.containsKey(input)) {
                        errors.add(error(call.id(), pointer + "/inputs/" + input, "call-process node '" + call.id()
                                + "' passes '" + input + "', which '" + call.processKey()
                                + "' does not declare in metadata.variables",
                                "Pass only variables the called process declares"));
                    }
                }
            }
            targets.put(call.id(), new CallTarget(call.processKey(), child.getDeploymentId(), child.getVersion(),
                    declared));
        }
        return new Resolution(Map.copyOf(targets), List.copyOf(errors));
    }

    /** Serializes pinned targets for {@code process_definitions.call_targets}; null when there are none. */
    public String toJson(Map<String, CallTarget> targets) {
        if (targets == null || targets.isEmpty()) return null;
        try {
            return json.writeValueAsString(new TreeMap<>(targets));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot serialize call targets", exception);
        }
    }

    /** The pinned targets of one deployed definition version, keyed by call node id. */
    public Map<String, CallTarget> targetsFor(String deploymentId, String storedJson) {
        if (storedJson == null || storedJson.isBlank()) return Map.of();
        return byDeployment.computeIfAbsent(deploymentId, ignored -> {
            try {
                return Map.copyOf(json.readValue(storedJson, TARGETS));
            } catch (JsonProcessingException exception) {
                throw new IllegalStateException("Stored call targets of deployment " + deploymentId
                        + " cannot be read", exception);
            }
        });
    }

    /** Whether a value fits a declared APL variable type ({@code any} and unknown types accept everything). */
    public static boolean fits(Object value, String type) {
        if (value == null || type == null) return true;
        return switch (type) {
            case "string" -> value instanceof String;
            case "number" -> value instanceof Number;
            case "integer" -> value instanceof Integer || value instanceof Long
                    || value instanceof java.math.BigInteger
                    || value instanceof Number number && number.doubleValue() == Math.rint(number.doubleValue());
            case "boolean" -> value instanceof Boolean;
            case "object" -> value instanceof Map;
            case "list" -> value instanceof List;
            default -> true;
        };
    }

    private static Map<String, String> declaredTypes(ProcessDefinitionEntity child) {
        if (DefinitionSchema.from(child.getSchemaType()) != DefinitionSchema.APL_NATIVE) return Map.of();
        try {
            JsonNode root = YAML.readTree(child.getBpmnXml());
            Map<String, String> declared = new LinkedHashMap<>();
            root.path("metadata").path("variables").forEach(variable -> {
                if (variable.path("name").isTextual()) {
                    declared.put(variable.path("name").asText(), variable.path("type").asText("any"));
                }
            });
            return declared;
        } catch (IOException exception) {
            return Map.of();
        }
    }

    private static Map<String, String> nodePointers(byte[] source) {
        Map<String, String> pointers = new LinkedHashMap<>();
        try {
            JsonNode nodes = YAML.readTree(new String(source, StandardCharsets.UTF_8)).path("flow").path("nodes");
            for (int index = 0; index < nodes.size(); index++) {
                pointers.putIfAbsent(nodes.get(index).path("id").asText(), "/flow/nodes/" + index);
            }
        } catch (IOException ignored) {
            // The parser already accepted this source.
        }
        return pointers;
    }

    private static BpmnValidationIssue error(String nodeId, String pointer, String message, String resolution) {
        return new BpmnValidationIssue(CALL_CODE, ValidationSeverity.ERROR, message, null, nodeId,
                AplParser.LANGUAGE_VERSION, null, resolution, pointer);
    }
}
