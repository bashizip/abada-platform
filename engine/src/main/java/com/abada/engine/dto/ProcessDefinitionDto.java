package com.abada.engine.dto;

import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * A deployed definition. {@code validationIssues} is set only on a deployment
 * response: the non-blocking warnings recorded when the definition was compiled
 * (APL schema and variable findings). It is omitted when there are none.
 */
public record ProcessDefinitionDto(
        String projectId,
        String id,
        String name,
        String documentation,
        String bpmnXml,
        String deploymentId,
        int version,
        String schemaType,
        Instant createdAt,
        @JsonInclude(JsonInclude.Include.NON_EMPTY) List<BpmnValidationIssue> validationIssues) {

    private static final ObjectMapper JSON = new ObjectMapper();

    public static ProcessDefinitionDto from(ProcessDefinitionEntity entity) {
        return new ProcessDefinitionDto(entity.getProjectId(), entity.getProcessKey(), entity.getName(), entity.getDocumentation(),
                entity.getBpmnXml(), entity.getDeploymentId(), entity.getVersion(), entity.getSchemaType(),
                entity.getCreatedAt(), List.of());
    }

    /** The deployment response: the definition plus the warnings recorded at compile time. */
    public static ProcessDefinitionDto deployed(ProcessDefinitionEntity entity) {
        ProcessDefinitionDto definition = from(entity);
        return new ProcessDefinitionDto(definition.projectId(), definition.id(), definition.name(),
                definition.documentation(), definition.bpmnXml(), definition.deploymentId(), definition.version(),
                definition.schemaType(), definition.createdAt(), recordedIssues(entity.getCompatibilityReport()));
    }

    private static List<BpmnValidationIssue> recordedIssues(String report) {
        if (report == null || report.isBlank()) return List.of();
        try {
            JsonNode issues = JSON.readTree(report).path("issues");
            List<BpmnValidationIssue> result = new ArrayList<>();
            for (JsonNode issue : issues) result.add(JSON.treeToValue(issue, BpmnValidationIssue.class));
            return List.copyOf(result);
        } catch (Exception exception) {
            return List.of();
        }
    }
}
