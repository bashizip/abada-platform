package com.abada.engine.dto;

import com.abada.engine.persistence.entity.ProjectResourceEntity;
import java.time.Instant;

public record ProjectResourceContentDTO(String id, String projectId, String folderId, String name,
        String contentType, long sizeBytes, String sha256, String kind, long revision,
        Instant createdAt, Instant updatedAt, String contentBase64) {
    public static ProjectResourceContentDTO from(ProjectResourceEntity entity) {
        return new ProjectResourceContentDTO(entity.getId(), entity.getProjectId(), entity.getFolderId(),
                entity.getName(), entity.getContentType(), entity.getSizeBytes(), entity.getSha256(),
                entity.getKind().name(), entity.getEntityVersion(), entity.getCreatedAt(),
                entity.getUpdatedAt(),
                java.util.Base64.getEncoder().encodeToString(entity.getContent()));
    }
}