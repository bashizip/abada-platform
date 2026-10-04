package com.abada.engine.apl;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.expression.ExecutionPolicy;
import com.abada.engine.parser.AplParser;
import com.abada.engine.parser.AplSchema;
import com.abada.engine.project.ProjectAccessService;
import com.abada.engine.tools.ToolRegistryService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * The public APL contract: the JSON Schema this engine accepts and a
 * side-effect-free validation that runs exactly the deployment pipeline
 * (schema, semantic parser, expression and execution policy, variable check).
 * Nothing here persists state or writes history.
 */
@Service
public class AplContractService {
    public record Validation(boolean valid, String processKey, List<BpmnValidationIssue> issues) {}
    public record ServedSchema(String json, String etag) {}

    private final AplParser parser;
    private final ObjectMapper objectMapper;
    private final ToolRegistryService toolRegistry;
    private final ProjectAccessService access;

    public AplContractService(AplParser parser, ObjectMapper objectMapper, ToolRegistryService toolRegistry,
            ProjectAccessService access) {
        this.parser = parser;
        this.objectMapper = objectMapper;
        this.toolRegistry = toolRegistry;
        this.access = access;
    }

    /**
     * The classpath schema with this deployment's runtime values: the allowed
     * agent models as the {@code agentModel} enum and {@code x-abada-runtime}.
     */
    public ServedSchema schema() {
        ObjectNode document = (ObjectNode) AplSchema.instance().document();
        List<String> models = parser.allowedAgentModels().stream().sorted().toList();
        if (!models.isEmpty()) {
            ArrayNode values = ((ObjectNode) document.at("/$defs/agentModel")).putArray("enum");
            models.forEach(values::add);
        }
        ObjectNode runtime = document.putObject("x-abada-runtime");
        runtime.put("languageVersion", AplParser.LANGUAGE_VERSION);
        runtime.put("scriptsEnabled", ExecutionPolicy.scriptsEnabled());
        runtime.put("schemaViolations", "WARNING");
        runtime.put("maxSourceBytes", AplParser.MAX_DEPLOYMENT_BYTES);
        models.forEach(runtime.putArray("allowedAgentModels")::add);
        try {
            String json = objectMapper.writeValueAsString(document);
            return new ServedSchema(json, "\"" + sha256(json) + "\"");
        } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
            throw new IllegalStateException("Cannot serialize the APL schema", exception);
        }
    }

    public Validation validate(String source) {
        return validate(source, null);
    }

    /**
     * Validates as deployment would. With a project, tool references are also
     * resolved against its tool servers (deployment always does this).
     */
    public Validation validate(String source, String projectId) {
        byte[] bytes = source.getBytes(StandardCharsets.UTF_8);
        if (projectId != null && !projectId.isBlank()) access.requireVisible(projectId);
        try {
            var result = parser.parseDetailed(bytes);
            List<BpmnValidationIssue> issues = new ArrayList<>(result.report().issues());
            if (projectId != null && !projectId.isBlank()) {
                List<BpmnValidationIssue> toolErrors = toolRegistry.resolve(projectId, bytes).errors();
                if (!toolErrors.isEmpty()) {
                    issues.addAll(0, toolErrors);
                    return new Validation(false, null, List.copyOf(issues));
                }
            }
            return new Validation(true, result.definition().getId(), List.copyOf(issues));
        } catch (BpmnValidationException exception) {
            List<BpmnValidationIssue> issues = new ArrayList<>(exception.getIssues());
            boolean valid = issues.stream().noneMatch(issue -> issue.severity() == ValidationSeverity.ERROR);
            return new Validation(valid, null, List.copyOf(issues));
        }
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
