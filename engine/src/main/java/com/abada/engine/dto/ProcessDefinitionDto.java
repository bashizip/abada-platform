package com.abada.engine.dto;

import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import java.time.Instant;

public record ProcessDefinitionDto(
        String projectId,
        String id,
        String name,
        String documentation,
        String bpmnXml,
        String deploymentId,
        int version,
        String schemaType,
        Instant createdAt) {

    public static ProcessDefinitionDto from(ProcessDefinitionEntity entity) {
        return new ProcessDefinitionDto(entity.getProjectId(), entity.getProcessKey(), entity.getName(), entity.getDocumentation(),
                entity.getBpmnXml(), entity.getDeploymentId(), entity.getVersion(), entity.getSchemaType(),
                entity.getCreatedAt());
    }
}
