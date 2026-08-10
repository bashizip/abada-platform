package com.abada.engine.dto;

import com.abada.engine.persistence.entity.ProjectResourceEntity;
import java.time.Instant;

public record ProjectResourceDTO(String id, String projectId, String folderId, String name,
        String contentType, long sizeBytes, String sha256, String kind, long revision,
        Instant createdAt, Instant updatedAt) {
    public static ProjectResourceDTO from(ProjectResourceEntity entity) {
        return new ProjectResourceDTO(entity.getId(), entity.getProjectId(), entity.getFolderId(),
                entity.getName(), entity.getContentType(), entity.getSizeBytes(), entity.getSha256(),
                entity.getKind().name(), entity.getEntityVersion(), entity.getCreatedAt(),
                entity.getUpdatedAt());
    }
}