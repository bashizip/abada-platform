package com.abada.engine.api;

import com.abada.engine.dto.ProjectFolderDTO;
import com.abada.engine.persistence.entity.ProjectFolderEntity;
import com.abada.engine.project.ProjectTreeService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/projects/{projectId}/folders")
public class ProjectFolderController {
    public record CreateFolderRequest(String parentId, String name) {}
    public record UpdateFolderRequest(long expectedRevision, String name, String parentId) {}

    private final ProjectTreeService trees;

    public ProjectFolderController(ProjectTreeService trees) { this.trees = trees; }

    @PostMapping
    public ResponseEntity<ProjectFolderDTO> create(@PathVariable String projectId,
            @RequestBody CreateFolderRequest request) {
        ProjectFolderEntity created = trees.createFolder(projectId, request.parentId(), request.name());
        return withRevision(projectId, created);
    }

    @PatchMapping("/{folderId}")
    public ResponseEntity<ProjectFolderDTO> update(@PathVariable String projectId,
            @PathVariable String folderId, @RequestBody UpdateFolderRequest request) {
        ProjectFolderEntity folder = trees.requireFolder(projectId, folderId);
        if (request.name() != null) {
            folder = trees.renameFolder(projectId, folderId, request.name());
        }
        if (request.parentId() != null) {
            folder = trees.moveFolder(projectId, folderId, request.parentId());
        }
        return withRevision(projectId, folder);
    }

    @DeleteMapping("/{folderId}")
    public ResponseEntity<Void> delete(@PathVariable String projectId,
            @PathVariable String folderId) {
        trees.deleteFolder(projectId, folderId);
        return ResponseEntity.noContent().build();
    }

    private ResponseEntity<ProjectFolderDTO> withRevision(String projectId, ProjectFolderEntity folder) {
        return ResponseEntity.ok().eTag(Long.toString(folder.getEntityVersion()))
                .body(ProjectFolderDTO.from(folder, trees.pathOf(projectId, folder)));
    }
}