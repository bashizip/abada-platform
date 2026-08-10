package com.abada.engine.dto;

import com.abada.engine.persistence.entity.ProjectFolderEntity;
import java.time.Instant;

public record ProjectFolderDTO(String id, String projectId, String parentId, String name,
        String path, long revision, boolean system, Instant createdAt, Instant updatedAt) {
    public static ProjectFolderDTO from(ProjectFolderEntity entity, String path) {
        return new ProjectFolderDTO(entity.getId(), entity.getProjectId(), entity.getParentId(),
                entity.getName(), path, entity.getEntityVersion(), entity.isSystemFolder(),
                entity.getCreatedAt(), entity.getUpdatedAt());
    }
}