package com.abada.engine.api;

import com.abada.engine.dto.ProcessDefinitionDto;
import com.abada.engine.dto.ProjectProcessDocumentDTO;
import com.abada.engine.project.ProjectDocumentService;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/projects/{projectId}/documents")
public class ProjectDocumentController {
    public record CreateDocumentRequest(String processKey, String description, String aplSource,
            String folderId, String fileName) {}
    public record SaveDocumentRequest(String description, String aplSource) {}
    public record UpdateDocumentRequest(long expectedRevision, String fileName, String folderId) {}
    public record ArchiveDocumentRequest(long expectedRevision, boolean archived) {}

    private final ProjectDocumentService documents;

    public ProjectDocumentController(ProjectDocumentService documents) { this.documents = documents; }

    @GetMapping
    public ResponseEntity<java.util.List<ProjectProcessDocumentDTO>> list(@PathVariable String projectId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        var pageable = PageRequest.of(page, Math.min(Math.max(size, 1), 100),
                Sort.by("updatedAt").descending());
        var result = documents.list(projectId, pageable);
        return ResponseEntity.ok().headers(Pagination.headers(result))
                .body(result.stream().map(ProjectProcessDocumentDTO::from).toList());
    }

    @PostMapping
    public ResponseEntity<ProjectProcessDocumentDTO> create(@PathVariable String projectId,
            @RequestBody CreateDocumentRequest request) {
        var created = documents.create(projectId, request.processKey(), request.description(),
                request.aplSource(), request.folderId(), request.fileName());
        return withRevision(created);
    }

    @GetMapping("/{documentId}")
    public ResponseEntity<ProjectProcessDocumentDTO> get(@PathVariable String projectId,
            @PathVariable String documentId) {
        return withRevision(documents.get(projectId, documentId));
    }

    @PatchMapping("/{documentId}")
    public ResponseEntity<ProjectProcessDocumentDTO> update(@PathVariable String projectId,
            @PathVariable String documentId, @RequestBody UpdateDocumentRequest request) {
        if (request.fileName() == null && request.folderId() == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Provide at least one of fileName or folderId");
        }
        var document = documents.get(projectId, documentId);
        if (request.fileName() != null) {
            document = documents.rename(projectId, documentId, request.expectedRevision(),
                    request.fileName());
        }
        if (request.folderId() != null) {
            document = documents.move(projectId, documentId, document.getEntityVersion(),
                    request.folderId());
        }
        return withRevision(document);
    }

    @PutMapping("/{documentId}")
    public ResponseEntity<ProjectProcessDocumentDTO> save(@PathVariable String projectId,
            @PathVariable String documentId, @RequestHeader(HttpHeaders.IF_MATCH) String ifMatch,
            @RequestBody SaveDocumentRequest request) {
        return withRevision(documents.save(projectId, documentId, revision(ifMatch),
                request.description(), request.aplSource()));
    }

    @PostMapping("/{documentId}/archive")
    public ResponseEntity<ProjectProcessDocumentDTO> archive(@PathVariable String projectId,
            @PathVariable String documentId, @RequestBody ArchiveDocumentRequest request) {
        return withRevision(documents.archive(projectId, documentId,
                request.expectedRevision(), request.archived()));
    }

    @PostMapping("/{documentId}/deploy")
    public ResponseEntity<ProcessDefinitionDto> deploy(@PathVariable String projectId,
            @PathVariable String documentId, @RequestHeader(HttpHeaders.IF_MATCH) String ifMatch) {
        return ResponseEntity.ok(ProcessDefinitionDto.from(
                documents.deploy(projectId, documentId, revision(ifMatch))));
    }

    private ResponseEntity<ProjectProcessDocumentDTO> withRevision(
            com.abada.engine.persistence.entity.ProjectProcessDocumentEntity entity) {
        return ResponseEntity.ok().eTag(Long.toString(entity.getEntityVersion()))
                .body(ProjectProcessDocumentDTO.from(entity));
    }

    private long revision(String ifMatch) {
        try {
            return Long.parseLong(ifMatch.replace("\"", "").strip());
        } catch (Exception exception) {
            throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    ApiErrorCode.INVALID_REQUEST, "If-Match must contain the current numeric revision");
        }
    }
}
