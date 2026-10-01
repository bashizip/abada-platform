package com.abada.engine.parser;

import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.PathType;
import com.networknt.schema.SchemaValidatorsConfig;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The APL v1 JSON Schema ({@code classpath:apl/apl-v1.schema.json}): the single
 * structural contract shared by the engine, the {@code /v1/apl/schema} endpoint
 * and the generated Studio types.
 *
 * <p>Schema findings are warnings ({@link #SCHEMA_CODE}) in the 1.1.0-rc line:
 * they report unknown fields, wrong value types and out-of-range values that
 * the semantic parser would otherwise ignore or default. The parser stays the
 * authority for errors.
 *
 * <p>The document root and each node are validated separately: a node is
 * checked only against the definition of its own {@code type}, so a wrong
 * field yields one precise finding instead of one per node type.
 */
public final class AplSchema {
    public static final String RESOURCE = "apl/apl-v1.schema.json";
    public static final String SCHEMA_CODE = "ABADA-APL-SCHEMA-001";
    /** Bounds the response for pathological documents. */
    static final int MAX_FINDINGS = 200;

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final AplSchema INSTANCE = new AplSchema();

    private final JsonNode document;
    private final JsonSchema rootSchema;
    private final Map<String, JsonSchema> nodeSchemas;
    private final Map<String, String> definitionByType;

    private AplSchema() {
        try (InputStream stream = AplSchema.class.getClassLoader().getResourceAsStream(RESOURCE)) {
            if (stream == null) throw new IllegalStateException("Missing " + RESOURCE + " on the classpath");
            this.document = JSON.readTree(stream);
        } catch (IOException exception) {
            throw new UncheckedIOException("Cannot read " + RESOURCE, exception);
        }
        JsonSchemaFactory factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012);
        SchemaValidatorsConfig config = SchemaValidatorsConfig.builder().pathType(PathType.JSON_POINTER).build();

        ObjectNode root = document.deepCopy();
        ((ObjectNode) root.at("/properties/flow/properties/nodes")).set("items", JSON.createObjectNode());
        this.rootSchema = factory.getSchema(root, config);

        Map<String, String> byType = new LinkedHashMap<>();
        Map<String, JsonSchema> schemas = new LinkedHashMap<>();
        for (JsonNode ref : document.at("/$defs/node/oneOf")) {
            String definition = ref.path("$ref").asText().replace("#/$defs/", "");
            String type = document.at("/$defs/" + definition + "/properties/type/const").asText();
            ObjectNode wrapper = JSON.createObjectNode();
            wrapper.put("$schema", document.path("$schema").asText());
            wrapper.put("$id", document.path("$id").asText().replace(".json", "/" + definition + ".json"));
            wrapper.put("$ref", "#/$defs/" + definition);
            wrapper.set("$defs", document.path("$defs"));
            byType.put(type, definition);
            schemas.put(type, factory.getSchema(wrapper, config));
        }
        this.definitionByType = Map.copyOf(byType);
        this.nodeSchemas = Map.copyOf(schemas);
    }

    public static AplSchema instance() {
        return INSTANCE;
    }

    /** An immutable copy of the schema document as stored on the classpath. */
    public JsonNode document() {
        return document.deepCopy();
    }

    /** Node types the schema defines; must equal the parser's supported types. */
    public Set<String> nodeTypes() {
        return definitionByType.keySet();
    }

    /** The {@code $defs} entry describing a node type, e.g. {@code agent -> agentNode}. */
    public String definitionFor(String type) {
        return definitionByType.get(type);
    }

    /** Structural findings as WARNING issues with JSON Pointer paths, ordered by path. */
    public List<BpmnValidationIssue> validate(JsonNode root) {
        List<BpmnValidationIssue> findings = new ArrayList<>();
        collect(rootSchema.validate(root), "", null, findings);
        JsonNode nodes = root.path("flow").path("nodes");
        if (nodes.isArray()) {
            for (int index = 0; index < nodes.size(); index++) {
                JsonNode node = nodes.get(index);
                if (!node.isObject()) continue; // the root pass and the parser report it
                JsonSchema schema = nodeSchemas.get(node.path("type").asText());
                if (schema == null) continue; // unknown type: a parser error
                String elementId = node.path("id").isTextual() ? node.path("id").asText() : null;
                collect(schema.validate(node), "/flow/nodes/" + index, elementId, findings);
            }
        }
        findings.sort(Comparator.comparing(BpmnValidationIssue::path));
        return findings.size() > MAX_FINDINGS ? List.copyOf(findings.subList(0, MAX_FINDINGS)) : findings;
    }

    private static void collect(Set<ValidationMessage> messages, String prefix, String elementId,
            List<BpmnValidationIssue> findings) {
        for (ValidationMessage message : messages) {
            String location = message.getInstanceLocation().toString();
            String path = prefix + (location.equals("/") ? "" : location);
            String field = path;
            if ("additionalProperties".equals(message.getType()) && message.getProperty() != null) {
                field = path + "/" + message.getProperty();
            }
            findings.add(new BpmnValidationIssue(SCHEMA_CODE, ValidationSeverity.WARNING,
                    (field.isEmpty() ? "document" : field) + ": " + describe(message),
                    null, elementId, AplParser.LANGUAGE_VERSION, null, resolution(message),
                    field.isEmpty() ? "/" : field));
        }
    }

    private static String describe(ValidationMessage message) {
        if ("additionalProperties".equals(message.getType())) {
            return "unknown field '" + message.getProperty() + "' is ignored by the engine";
        }
        return message.getError();
    }

    private static String resolution(ValidationMessage message) {
        if ("additionalProperties".equals(message.getType())) {
            return "Remove the field or fix its spelling; see GET /api/v1/apl/schema for the fields each node accepts."
                    + " Unknown fields become deployment errors in 1.1.0.";
        }
        return "Fix the value to match GET /api/v1/apl/schema; schema violations become deployment errors in 1.1.0.";
    }
}
