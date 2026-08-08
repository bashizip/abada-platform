package com.abada.engine.dto;

import com.abada.engine.persistence.entity.ProjectProcessDocumentEntity;
import java.time.Instant;

public record ProjectProcessDocumentDTO(String id, String projectId, String processKey,
        String name, String description, String aplSource, String status, long revision,
        Instant createdAt, Instant updatedAt, String lastSavedBy,
        String lastDeploymentId, String lastDeployedChecksum) {
    public static ProjectProcessDocumentDTO from(ProjectProcessDocumentEntity entity) {
        return new ProjectProcessDocumentDTO(entity.getId(), entity.getProjectId(), entity.getProcessKey(),
                entity.getName(), entity.getDescription(), entity.getAplSource(), entity.getStatus().name(),
                entity.getEntityVersion(), entity.getCreatedAt(), entity.getUpdatedAt(),
                entity.getLastSavedBy(), entity.getLastDeploymentId(), entity.getLastDeployedChecksum());
    }
}
