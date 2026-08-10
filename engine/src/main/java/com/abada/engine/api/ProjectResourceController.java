package com.abada.engine.api;

import com.abada.engine.dto.ProjectResourceContentDTO;
import com.abada.engine.dto.ProjectResourceDTO;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.project.ProjectTreeService;
import java.util.Base64;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/projects/{projectId}/resources")
public class ProjectResourceController {
    public record CreateResourceRequest(String name, String folderId, String kind,
            String contentType, String contentBase64) {}
    public record ReplaceResourceRequest(long expectedRevision, String contentType,
            String contentBase64) {}
    public record UpdateResourceRequest(long expectedRevision, String name, String folderId) {}

    private final ProjectTreeService trees;

    public ProjectResourceController(ProjectTreeService trees) { this.trees = trees; }

    @PostMapping
    public ResponseEntity<ProjectResourceDTO> create(@PathVariable String projectId,
            @RequestBody CreateResourceRequest request) {
        ProjectResourceEntity created = trees.createResource(projectId, request.folderId(),
                request.name(), request.contentType(), kind(request.kind()), decode(request.contentBase64()));
        return withRevision(created);
    }

    @GetMapping("/{resourceId}")
    public ResponseEntity<ProjectResourceContentDTO> get(@PathVariable String projectId,
            @PathVariable String resourceId) {
        ProjectResourceEntity resource = trees.getResource(projectId, resourceId);
        return ResponseEntity.ok().eTag(Long.toString(resource.getEntityVersion()))
                .body(ProjectResourceContentDTO.from(resource));
    }

    @PutMapping("/{resourceId}")
    public ResponseEntity<ProjectResourceDTO> replace(@PathVariable String projectId,
            @PathVariable String resourceId, @RequestBody ReplaceResourceRequest request) {
        ProjectResourceEntity updated = trees.replaceResource(projectId, resourceId,
                request.expectedRevision(), request.contentType(), decode(request.contentBase64()));
        return withRevision(updated);
    }

    @PatchMapping("/{resourceId}")
    public ResponseEntity<ProjectResourceDTO> update(@PathVariable String projectId,
            @PathVariable String resourceId, @RequestBody UpdateResourceRequest request) {
        ProjectResourceEntity resource = trees.requireResource(projectId, resourceId);
        if (request.name() != null) {
            resource = trees.renameResource(projectId, resourceId,
                    request.expectedRevision(), request.name());
        }
        if (request.folderId() != null) {
            resource = trees.moveResource(projectId, resourceId,
                    resource.getEntityVersion(), request.folderId());
        }
        return withRevision(resource);
    }

    @DeleteMapping("/{resourceId}")
    public ResponseEntity<Void> delete(@PathVariable String projectId,
            @PathVariable String resourceId) {
        trees.deleteResource(projectId, resourceId);
        return ResponseEntity.noContent().build();
    }

    public ProjectResourceEntity.Kind kind(String value) {
        if (value == null || value.isBlank()) return ProjectResourceEntity.Kind.RESOURCE;
        try {
            return ProjectResourceEntity.Kind.valueOf(value.strip().toUpperCase());
        } catch (IllegalArgumentException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Resource kind must be FORM or RESOURCE");
        }
    }

    private byte[] decode(String contentBase64) {
        if (contentBase64 == null) return new byte[0];
        try {
            return Base64.getDecoder().decode(contentBase64);
        } catch (IllegalArgumentException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "contentBase64 must be valid base64");
        }
    }

    private ResponseEntity<ProjectResourceDTO> withRevision(ProjectResourceEntity resource) {
        return ResponseEntity.ok().eTag(Long.toString(resource.getEntityVersion()))
                .body(ProjectResourceDTO.from(resource));
    }
}