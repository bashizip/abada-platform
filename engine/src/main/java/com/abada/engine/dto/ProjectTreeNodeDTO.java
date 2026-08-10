package com.abada.engine.dto;

import com.abada.engine.persistence.entity.ProjectProcessDocumentEntity;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

/**
 * A single node of the project file tree. Folders and files are untyped in
 * JSON; the {@code kind} discriminates FOLDER, DOCUMENT (APL process) and
 * RESOURCE (generic typed file such as a form schema). System folders are
 * locked roots that can never be renamed, moved or deleted.
 */
public record ProjectTreeNodeDTO(String id, String kind, String name, String fileName,
        String processKey, String contentType, String status, String path, long revision,
        boolean system,
        @Schema(name = "children", description = "Child nodes (folders and files)") List<ProjectTreeNodeDTO> children) {

    public static ProjectTreeNodeDTO folder(String id, String name, String path, long revision,
            boolean system, List<ProjectTreeNodeDTO> children) {
        return new ProjectTreeNodeDTO(id, "FOLDER", name, null, null, null, null, path, revision,
                system, children);
    }

    public static ProjectTreeNodeDTO document(ProjectProcessDocumentEntity entity, String path) {
        return new ProjectTreeNodeDTO(entity.getId(), "DOCUMENT",
                displayName(entity), entity.getFileName(), entity.getProcessKey(), null,
                entity.getStatus().name(), path, entity.getEntityVersion(), false, List.of());
    }

    public static ProjectTreeNodeDTO resource(String id, String name, String contentType,
            String kind, String path, long revision) {
        return new ProjectTreeNodeDTO(id, "RESOURCE", name, null, null, contentType, kind, path,
                revision, false, List.of());
    }

    public ProjectTreeNodeDTO withChildren(List<ProjectTreeNodeDTO> value) {
        return new ProjectTreeNodeDTO(id, kind, name, fileName, processKey, contentType, status,
                path, revision, system, value);
    }

    private static String displayName(ProjectProcessDocumentEntity entity) {
        return entity.getFileName() != null ? entity.getFileName() : entity.getName() + ".apl.yaml";
    }
}