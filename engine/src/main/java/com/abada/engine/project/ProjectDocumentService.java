package com.abada.engine.project;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.insight.InsightProposalService.InsightConflictException;
import com.abada.engine.parser.AplParser;
import org.springframework.beans.factory.annotation.Value;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.persistence.entity.ProjectProcessDocumentEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.entity.ProjectFolderEntity;
import com.abada.engine.persistence.repository.ProjectProcessDocumentRepository;
import com.abada.engine.persistence.repository.ProjectFolderRepository;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProjectDocumentService {
    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(ProjectDocumentService.class);
    private static final java.util.regex.Pattern FORM_KEY_ATTR =
            java.util.regex.Pattern.compile("formKey\\s*=\\s*\"([^\"]+)\"");

    private final ProjectProcessDocumentRepository documents;
    private final ProjectFolderRepository folders;
    private final ProjectAccessService access;
    private final AbadaEngine engine;
    private final ProjectTreeService trees;
    private final AplParser aplParser;

    public ProjectDocumentService(ProjectProcessDocumentRepository documents,
            ProjectFolderRepository folders, ProjectAccessService access, AbadaEngine engine,
            ProjectTreeService trees,
            @Value("${abada.agent.allowed-models:" + AplParser.DEFAULT_ALLOWED_AGENT_MODELS + "}") String allowedAgentModels) {
        this.documents = documents;
        this.folders = folders;
        this.access = access;
        this.engine = engine;
        this.trees = trees;
        this.aplParser = new AplParser(allowedAgentModels);
    }

    @Transactional(readOnly = true)
    public Page<ProjectProcessDocumentEntity> list(String projectId, Pageable pageable) {
        access.requireVisible(projectId);
        return documents.findByProjectIdAndStatus(projectId,
                ProjectProcessDocumentEntity.Status.ACTIVE, pageable);
    }

    @Transactional(readOnly = true)
    public ProjectProcessDocumentEntity get(String projectId, String documentId) {
        access.requireVisible(projectId);
        return find(projectId, documentId);
    }

    @Transactional
    public ProjectProcessDocumentEntity create(String projectId, String processKey,
            String description, String aplSource) {
        return create(projectId, processKey, description, aplSource, null, null);
    }

    @Transactional
    public ProjectProcessDocumentEntity create(String projectId, String processKey,
            String description, String aplSource, String folderId, String fileName) {
        access.requireActive(projectId, Role.MAINTAINER);
        var parsed = parse(aplSource);
        String key = validateKey(processKey);
        if (!key.equals(parsed.getId())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Document processKey must match APL metadata.key");
        }
        if (documents.findByProjectIdAndProcessKey(projectId, key).isPresent()) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.CONCURRENT_MODIFICATION,
                    "A process document with this key already exists in the project");
        }
        String folder = ProjectTreeService.nullIfBlank(folderId);
        if (folder != null) requireFolder(projectId, folder);
        validateFileName(fileName);
        Instant now = Instant.now();
        ProjectProcessDocumentEntity document = new ProjectProcessDocumentEntity();
        document.setProjectId(projectId);
        document.setProcessKey(key);
        document.setFolderId(folder);
        document.setFileName(fileName);
        document.setName(parsed.getName());
        document.setDescription(description == null ? "" : description.strip());
        document.setAplSource(aplSource);
        document.setCreatedAt(now);
        document.setUpdatedAt(now);
        document.setLastSavedBy(access.identity().username());
        return documents.save(document);
    }

    /** Replaces the display file name only; processKey and APL metadata are untouched. */
    @Transactional
    public ProjectProcessDocumentEntity rename(String projectId, String documentId,
            long expectedRevision, String fileName) {
        access.requireActive(projectId, Role.MAINTAINER);
        ProjectProcessDocumentEntity document = find(projectId, documentId);
        requireMutable(document);
        if (document.getEntityVersion() != expectedRevision) throw conflict();
        validateFileName(fileName);
        document.setFileName(fileName);
        document.setUpdatedAt(Instant.now());
        document.setLastSavedBy(access.identity().username());
        return documents.save(document);
    }

    /** Moves the document into another folder of the same project (null = project root). */
    @Transactional
    public ProjectProcessDocumentEntity move(String projectId, String documentId,
            long expectedRevision, String folderId) {
        access.requireActive(projectId, Role.MAINTAINER);
        ProjectProcessDocumentEntity document = find(projectId, documentId);
        requireMutable(document);
        if (document.getEntityVersion() != expectedRevision) throw conflict();
        String folder = ProjectTreeService.nullIfBlank(folderId);
        if (folder != null) requireFolder(projectId, folder);
        document.setFolderId(folder);
        document.setUpdatedAt(Instant.now());
        document.setLastSavedBy(access.identity().username());
        return documents.save(document);
    }

    @Transactional
    public ProjectProcessDocumentEntity save(String projectId, String documentId,
            long expectedRevision, String description, String aplSource) {
        access.requireActive(projectId, Role.MAINTAINER);
        ProjectProcessDocumentEntity document = find(projectId, documentId);
        if (document.getStatus() != ProjectProcessDocumentEntity.Status.ACTIVE) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "Archived process documents are read-only");
        }
        if (document.getEntityVersion() != expectedRevision) throw conflict();
        var parsed = parse(aplSource);
        if (!document.getProcessKey().equals(parsed.getId())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "APL metadata.key is immutable and must match the document processKey");
        }
        document.setName(parsed.getName());
        document.setDescription(description == null ? "" : description.strip());
        document.setAplSource(aplSource);
        document.setUpdatedAt(Instant.now());
        document.setLastSavedBy(access.identity().username());
        return documents.save(document);
    }

    @Transactional
    public ProjectProcessDocumentEntity archive(String projectId, String documentId,
            long expectedRevision, boolean archived) {
        access.requireActive(projectId, Role.MAINTAINER);
        ProjectProcessDocumentEntity document = find(projectId, documentId);
        if (document.getEntityVersion() != expectedRevision) throw conflict();
        document.setStatus(archived ? ProjectProcessDocumentEntity.Status.ARCHIVED
                : ProjectProcessDocumentEntity.Status.ACTIVE);
        document.setUpdatedAt(Instant.now());
        return documents.save(document);
    }

    @Transactional
    public ProcessDefinitionEntity deploy(String projectId, String documentId, long expectedRevision) {
        access.requireActive(projectId, Role.MAINTAINER);
        ProjectProcessDocumentEntity document = find(projectId, documentId);
        if (document.getEntityVersion() != expectedRevision) throw conflict();
        ProcessDefinitionEntity deployed = engine.deploy(projectId, new ByteArrayInputStream(
                document.getAplSource().getBytes(StandardCharsets.UTF_8)));
        if (!document.getProcessKey().equals(deployed.getProcessKey())) {
            throw new IllegalStateException("Compiled process key differs from its project document");
        }
        warnUnresolvedFormKeys(projectId, deployed.getBpmnXml());
        document.setLastDeploymentId(deployed.getDeploymentId());
        document.setLastDeployedChecksum(deployed.getChecksum());
        document.setUpdatedAt(Instant.now());
        documents.save(document);
        return deployed;
    }

    /**
     * Soft validation: a human node may reference a form key that does not
     * (yet) resolve to a FORM resource. Forms are live project resources, so
     * this is a warning, never a deployment blocker.
     */
    private void warnUnresolvedFormKeys(String projectId, String bpmnXml) {
        if (bpmnXml == null) {
            return;
        }
        java.util.Set<String> seen = new java.util.LinkedHashSet<>();
        java.util.regex.Matcher matcher = FORM_KEY_ATTR.matcher(bpmnXml);
        while (matcher.find()) {
            String formKey = matcher.group(1).strip();
            if (formKey.isEmpty() || !seen.add(formKey)) {
                continue;
            }
            if (trees.findFormByKey(projectId, formKey).isEmpty()) {
                log.warn("Deployed process references form key '{}' that does not resolve "
                        + "to a project form (project {})", formKey, projectId);
            }
        }
    }

    private com.abada.engine.core.model.ParsedProcessDefinition parse(String source) {
        if (source == null || source.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "APL source is required");
        }
        return aplParser.parse(source.getBytes(StandardCharsets.UTF_8));
    }

    private String validateKey(String key) {
        String value = key == null ? "" : key.strip();
        if (!value.matches("[a-z][a-z0-9_-]{0,127}")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "processKey must match [a-z][a-z0-9_-]{0,127}");
        }
        return value;
    }

    private ProjectProcessDocumentEntity find(String projectId, String documentId) {
        return documents.findByIdAndProjectId(documentId, projectId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "Project process document not found"));
    }

    private ProjectFolderEntity requireFolder(String projectId, String folderId) {
        return folders.findByIdAndProjectId(folderId, projectId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "Project folder not found"));
    }

    private void requireMutable(ProjectProcessDocumentEntity document) {
        if (document.getStatus() != ProjectProcessDocumentEntity.Status.ACTIVE) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "Archived process documents are read-only");
        }
    }

    private void validateFileName(String fileName) {
        if (fileName == null) return;
        String value = fileName.strip();
        if (value.isBlank() || value.length() > 255 || value.contains("/")
                || value.equals(".") || value.equals("..")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "File name must contain 1 to 255 characters without '/'");
        }
    }

    private InsightConflictException conflict() {
        return new InsightConflictException("Process document changed concurrently; reload before saving");
    }
}
