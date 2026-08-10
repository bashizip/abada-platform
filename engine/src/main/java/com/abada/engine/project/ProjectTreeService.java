package com.abada.engine.project;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.dto.ProjectResourceDTO;
import com.abada.engine.dto.ProjectTreeNodeDTO;
import com.abada.engine.insight.InsightProposalService.InsightConflictException;
import com.abada.engine.persistence.entity.ProjectFolderEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.entity.ProjectProcessDocumentEntity;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.persistence.repository.ProjectFolderRepository;
import com.abada.engine.persistence.repository.ProjectProcessDocumentRepository;
import com.abada.engine.persistence.repository.ProjectResourceRepository;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owns the project file tree: the six locked system root folders, nested
 * user folders, generic typed resources and the assembly of the workspace
 * view consumed by IDE-like clients. Process documents are placed in this
 * tree through the folder on the document entity; their file operations live
 * in {@link ProjectDocumentService}.
 */
@Service
public class ProjectTreeService {
    public static final String DEFAULT_DOCUMENT_EXTENSION = ".apl.yaml";
    /**
     * Mandatory, immutable root folders in canonical display order. They are
     * seeded on project creation, backfilled for existing projects by the
     * schema migration and locked against rename, move and delete.
     */
    public static final List<String> SYSTEM_ROOT_FOLDER_NAMES = List.of(
            "processes", "resources", "forms", "media", "agents", "tests");
    private static final int USER_FOLDER_RANK = SYSTEM_ROOT_FOLDER_NAMES.size();
    private static final Set<String> RESERVED_NAMES = Set.of(".", "..");

    private final ProjectFolderRepository folders;
    private final ProjectResourceRepository resources;
    private final ProjectProcessDocumentRepository documents;
    private final ProjectAccessService access;

    public ProjectTreeService(ProjectFolderRepository folders, ProjectResourceRepository resources,
            ProjectProcessDocumentRepository documents, ProjectAccessService access) {
        this.folders = folders;
        this.resources = resources;
        this.documents = documents;
        this.access = access;
    }

    @Transactional(readOnly = true)
    public List<ProjectTreeNodeDTO> tree(String projectId) {
        access.requireVisible(projectId);
        List<ProjectFolderEntity> allFolders = folders.findByProjectIdOrderByNameAsc(projectId);
        List<ProjectProcessDocumentEntity> activeDocuments = documents
                .findByProjectIdAndStatusOrderByNameAsc(projectId,
                        ProjectProcessDocumentEntity.Status.ACTIVE);
        List<ProjectResourceEntity> allResources = resources.findByProjectIdOrderByNameAsc(projectId);

        Map<String, List<ProjectFolderEntity>> foldersByParent = new HashMap<>();
        for (ProjectFolderEntity folder : allFolders) {
            foldersByParent.computeIfAbsent(folder.getParentId() == null ? "" : folder.getParentId(),
                    key -> new ArrayList<>()).add(folder);
        }
        Map<String, List<ProjectProcessDocumentEntity>> documentsByFolder = new HashMap<>();
        for (ProjectProcessDocumentEntity document : activeDocuments) {
            documentsByFolder.computeIfAbsent(document.getFolderId() == null ? ""
                    : document.getFolderId(), key -> new ArrayList<>()).add(document);
        }
        Map<String, List<ProjectResourceEntity>> resourcesByFolder = new HashMap<>();
        for (ProjectResourceEntity resource : allResources) {
            resourcesByFolder.computeIfAbsent(resource.getFolderId() == null ? ""
                    : resource.getFolderId(), key -> new ArrayList<>()).add(resource);
        }
        Comparator<ProjectTreeNodeDTO> bySystemOrder = (a, b) -> {
            if (a.kind().equals("FOLDER") && b.kind().equals("FOLDER")) {
                int rank = Integer.compare(systemRank(a.name()), systemRank(b.name()));
                if (rank != 0) return rank;
                return String.CASE_INSENSITIVE_ORDER.compare(a.name(), b.name());
            }
            return 0;
        };
        Comparator<ProjectTreeNodeDTO> byName =
                Comparator.comparing(ProjectTreeNodeDTO::name, String.CASE_INSENSITIVE_ORDER);
        return treeChildren("", null, foldersByParent, documentsByFolder, resourcesByFolder,
                bySystemOrder.thenComparing(byName.thenComparing(ProjectTreeNodeDTO::kind)));
    }

    @Transactional
    public ProjectFolderEntity createFolder(String projectId, String parentId, String name) {
        access.requireActive(projectId, Role.MAINTAINER);
        validateNodeName(name, "Folder");
        if (SYSTEM_ROOT_FOLDER_NAMES.contains(name)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Folder names " + SYSTEM_ROOT_FOLDER_NAMES
                            + " are reserved for the system root folders");
        }
        String parent = nullIfBlank(parentId);
        if (parent == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "The project root holds only the system folders; create folders inside them");
        }
        requireFolder(projectId, parent);
        if (foldersByName(projectId, parent).contains(name)) throw duplicateFolder(parent);
        Instant now = Instant.now();
        ProjectFolderEntity folder = new ProjectFolderEntity();
        folder.setProjectId(projectId);
        folder.setParentId(parentId);
        folder.setName(name);
        folder.setCreatedAt(now);
        folder.setUpdatedAt(now);
        return folders.save(folder);
    }

    @Transactional
    public ProjectFolderEntity renameFolder(String projectId, String folderId, String name) {
        access.requireActive(projectId, Role.MAINTAINER);
        validateNodeName(name, "Folder");
        if (SYSTEM_ROOT_FOLDER_NAMES.contains(name)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Folder names " + SYSTEM_ROOT_FOLDER_NAMES
                            + " are reserved for the system root folders");
        }
        ProjectFolderEntity folder = requireFolder(projectId, folderId);
        requireUserFolder(folder);
        if (foldersByName(projectId, folder.getParentId()).contains(name)
                && !folder.getName().equals(name)) throw duplicateFolder(folder.getParentId());
        folder.setName(name);
        folder.setUpdatedAt(Instant.now());
        return folders.save(folder);
    }

    @Transactional
    public ProjectFolderEntity moveFolder(String projectId, String folderId, String newParentId) {
        access.requireActive(projectId, Role.MAINTAINER);
        ProjectFolderEntity folder = requireFolder(projectId, folderId);
        requireUserFolder(folder);
        String parent = nullIfBlank(newParentId);
        if (parent == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "The project root is reserved for the system folders");
        }
        requireFolder(projectId, parent);
        if (parent.equals(folderId)
                || descendants(projectId, folderId).contains(parent)) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "A folder cannot be moved into itself or one of its descendants");
        }
        if (foldersByName(projectId, parent).contains(folder.getName())
                && !folder.getParentId().equals(parent)) throw duplicateFolder(parent);
        folder.setParentId(parent);
        folder.setUpdatedAt(Instant.now());
        return folders.save(folder);
    }

    /**
     * Archives every active process document in the subtree, deletes the
     * generic resources, then removes the folders deepest-first. Process
     * documents are never physically removed because their deployments and
     * instances are immutable.
     */
    @Transactional
    public void deleteFolder(String projectId, String folderId) {
        access.requireActive(projectId, Role.MAINTAINER);
        ProjectFolderEntity root = requireFolder(projectId, folderId);
        requireUserFolder(root);
        Set<String> subtree = subtreeIds(projectId, root);

        List<ProjectProcessDocumentEntity> activeDocuments = documents
                .findByProjectIdAndStatusAndFolderIdIn(projectId,
                        ProjectProcessDocumentEntity.Status.ACTIVE, subtree);
        for (ProjectProcessDocumentEntity document : activeDocuments) {
            document.setStatus(ProjectProcessDocumentEntity.Status.ARCHIVED);
            document.setFolderId(null);
            document.setUpdatedAt(Instant.now());
        }
        documents.saveAll(activeDocuments);

        List<ProjectResourceEntity> inSubtree = resources.findByFolderIdIn(subtree);
        resources.deleteAll(inSubtree);

        List<ProjectFolderEntity> all = folders.findByProjectIdOrderByNameAsc(projectId);
        Map<String, ProjectFolderEntity> byId = new HashMap<>();
        for (ProjectFolderEntity folder : all) byId.put(folder.getId(), folder);
        List<ProjectFolderEntity> ordered = new ArrayList<>();
        for (String id : subtree) ordered.add(byId.get(id));
        ordered.sort(Comparator.comparingInt((ProjectFolderEntity folder) -> depth(byId, folder))
                .reversed());
        folders.deleteAll(ordered);
    }

    @Transactional
    public ProjectResourceEntity createResource(String projectId, String folderId, String name,
            String contentType, ProjectResourceEntity.Kind kind, byte[] content) {
        access.requireActive(projectId, Role.MAINTAINER);
        validateNodeName(name, "File");
        String folder = nullIfBlank(folderId);
        if (folder != null) requireFolder(projectId, folder);
        if (resources.existsByProjectIdAndFolderIdAndName(projectId, folder, name)) {
            throw duplicateResource(folder);
        }
        Instant now = Instant.now();
        ProjectResourceEntity resource = new ProjectResourceEntity();
        resource.setProjectId(projectId);
        resource.setFolderId(folder);
        resource.setName(name);
        resource.setContentType(contentType == null ? "" : contentType.strip());
        resource.setSizeBytes(content.length);
        resource.setSha256(sha256(content));
        resource.setContent(content);
        resource.setKind(kind == null ? ProjectResourceEntity.Kind.RESOURCE : kind);
        resource.setCreatedAt(now);
        resource.setUpdatedAt(now);
        return resources.save(resource);
    }

    @Transactional(readOnly = true)
    public ProjectResourceEntity getResource(String projectId, String resourceId) {
        access.requireVisible(projectId);
        return requireResource(projectId, resourceId);
    }

    @Transactional
    public ProjectResourceEntity replaceResource(String projectId, String resourceId,
            long expectedRevision, String contentType, byte[] content) {
        access.requireActive(projectId, Role.MAINTAINER);
        ProjectResourceEntity resource = requireResource(projectId, resourceId);
        if (resource.getEntityVersion() != expectedRevision) throw conflict();
        resource.setContentType(contentType == null ? "" : contentType.strip());
        resource.setSizeBytes(content.length);
        resource.setSha256(sha256(content));
        resource.setContent(content);
        resource.setUpdatedAt(Instant.now());
        return resources.save(resource);
    }

    @Transactional
    public ProjectResourceEntity renameResource(String projectId, String resourceId,
            long expectedRevision, String name) {
        access.requireActive(projectId, Role.MAINTAINER);
        validateNodeName(name, "File");
        ProjectResourceEntity resource = requireResource(projectId, resourceId);
        if (resource.getEntityVersion() != expectedRevision) throw conflict();
        if (resources.existsByProjectIdAndFolderIdAndName(projectId, resource.getFolderId(), name)
                && !resource.getName().equals(name)) throw duplicateResource(resource.getFolderId());
        resource.setName(name);
        resource.setUpdatedAt(Instant.now());
        return resources.save(resource);
    }

    @Transactional
    public ProjectResourceEntity moveResource(String projectId, String resourceId,
            long expectedRevision, String folderId) {
        access.requireActive(projectId, Role.MAINTAINER);
        String folder = nullIfBlank(folderId);
        if (folder != null) requireFolder(projectId, folder);
        ProjectResourceEntity resource = requireResource(projectId, resourceId);
        if (resource.getEntityVersion() != expectedRevision) throw conflict();
        if (resources.existsByProjectIdAndFolderIdAndName(projectId, folder, resource.getName())
                && !java.util.Objects.equals(folder, resource.getFolderId())) {
            throw duplicateResource(folder);
        }
        resource.setFolderId(folder);
        resource.setUpdatedAt(Instant.now());
        return resources.save(resource);
    }

    @Transactional
    public void deleteResource(String projectId, String resourceId) {
        access.requireActive(projectId, Role.MAINTAINER);
        resources.delete(requireResource(projectId, resourceId));
    }

    public ProjectFolderEntity requireFolder(String projectId, String folderId) {
        return folders.findByIdAndProjectId(folderId, projectId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "Project folder not found"));
    }

    private void requireUserFolder(ProjectFolderEntity folder) {
        if (folder.isSystemFolder()) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "System folders are locked and cannot be renamed, moved or deleted");
        }
    }

    private int systemRank(String name) {
        int rank = SYSTEM_ROOT_FOLDER_NAMES.indexOf(name);
        return rank < 0 ? USER_FOLDER_RANK : rank;
    }

    public String pathOf(String projectId, ProjectFolderEntity folder) {
        Map<String, ProjectFolderEntity> byId = new HashMap<>();
        for (ProjectFolderEntity all : folders.findByProjectIdOrderByNameAsc(projectId)) {
            byId.put(all.getId(), all);
        }
        return breadcrumb(byId, folder);
    }

    private List<ProjectTreeNodeDTO> treeChildren(String folderId, String path,
            Map<String, List<ProjectFolderEntity>> foldersByParent,
            Map<String, List<ProjectProcessDocumentEntity>> documentsByFolder,
            Map<String, List<ProjectResourceEntity>> resourcesByFolder,
            Comparator<ProjectTreeNodeDTO> byName) {
        List<ProjectTreeNodeDTO> nodes = new ArrayList<>();
        for (ProjectFolderEntity folder : foldersByParent.getOrDefault(folderId, List.of())) {
            String childPath = joinPath(path, folder.getName());
            nodes.add(ProjectTreeNodeDTO.folder(folder.getId(), folder.getName(), childPath,
                    folder.getEntityVersion(), folder.isSystemFolder(),
                    treeChildren(folder.getId(), childPath,
                            foldersByParent, documentsByFolder, resourcesByFolder, byName)));
        }
        for (ProjectProcessDocumentEntity document : documentsByFolder.getOrDefault(folderId, List.of())) {
            nodes.add(ProjectTreeNodeDTO.document(document, joinPath(path, fileNameOf(document))));
        }
        for (ProjectResourceEntity resource : resourcesByFolder.getOrDefault(folderId, List.of())) {
            nodes.add(ProjectTreeNodeDTO.resource(resource.getId(), resource.getName(),
                    resource.getContentType(), resource.getKind().name(),
                    joinPath(path, resource.getName()), resource.getEntityVersion()));
        }
        nodes.sort(byName.thenComparing(ProjectTreeNodeDTO::kind));
        return nodes;
    }

    private Set<String> descendants(String projectId, String folderId) {
        Set<String> result = new HashSet<>();
        for (ProjectFolderEntity folder : folders.findByProjectIdOrderByNameAsc(projectId)) {
            if (folder.getParentId() != null && folder.getParentId().equals(folderId)) {
                result.add(folder.getId());
                result.addAll(descendants(projectId, folder.getId()));
            }
        }
        return result;
    }

    private Set<String> subtreeIds(String projectId, ProjectFolderEntity root) {
        Set<String> result = descendants(projectId, root.getId());
        result.add(root.getId());
        return result;
    }

    private Set<String> foldersByName(String projectId, String parentId) {
        Set<String> names = new HashSet<>();
        for (ProjectFolderEntity folder : folders.findByProjectIdOrderByNameAsc(projectId)) {
            if (java.util.Objects.equals(folder.getParentId(), parentId)) names.add(folder.getName());
        }
        return names;
    }

    public ProjectResourceEntity requireResource(String projectId, String resourceId) {
        return resources.findByIdAndProjectId(resourceId, projectId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "Project resource not found"));
    }

    /**
     * API clients express "project root" as an empty string because a JSON
     * {@code null} would be indistinguishable from an absent field. Blank
     * parent/folder identifiers are normalized back to {@code null}.
     */
    public static String nullIfBlank(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private void validateNodeName(String name, String label) {
        String value = name == null ? "" : name.strip();
        if (value.isBlank() || value.length() > 255 || value.contains("/") || RESERVED_NAMES.contains(value)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    label + " name must contain 1 to 255 characters without '/'");
        }
    }

    private ApiException duplicateFolder(String parentId) {
        return new ApiException(HttpStatus.CONFLICT, ApiErrorCode.CONCURRENT_MODIFICATION,
                "A folder with this name already exists in the target folder");
    }

    private ApiException duplicateResource(String folderId) {
        return new ApiException(HttpStatus.CONFLICT, ApiErrorCode.CONCURRENT_MODIFICATION,
                "A file with this name already exists in the target folder");
    }

    private InsightConflictException conflict() {
        return new InsightConflictException("Project resource changed concurrently; reload before saving");
    }

    private String fileNameOf(ProjectProcessDocumentEntity document) {
        return document.getFileName() != null ? document.getFileName()
                : document.getName() + DEFAULT_DOCUMENT_EXTENSION;
    }

    private String joinPath(String parent, String name) {
        return parent == null || parent.isBlank() ? name : parent + "/" + name;
    }

    private String breadcrumb(Map<String, ProjectFolderEntity> byId, ProjectFolderEntity folder) {
        List<String> segments = new ArrayList<>();
        ProjectFolderEntity current = folder;
        while (current != null) {
            segments.add(0, current.getName());
            current = current.getParentId() == null ? null : byId.get(current.getParentId());
        }
        return String.join("/", segments);
    }

    private int depth(Map<String, ProjectFolderEntity> byId, ProjectFolderEntity folder) {
        int depth = 0;
        ProjectFolderEntity current = folder;
        while (current.getParentId() != null) {
            depth++;
            current = byId.get(current.getParentId());
            if (current == null) break;
        }
        return depth;
    }

    private String sha256(byte[] content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] encoded = digest.digest(content);
            StringBuilder hex = new StringBuilder(64);
            for (byte value : encoded) hex.append(String.format("%02x", value));
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }
}