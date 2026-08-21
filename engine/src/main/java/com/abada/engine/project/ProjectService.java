package com.abada.engine.project;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.insight.InsightProposalService.InsightConflictException;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.ProjectEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.persistence.repository.ProjectFolderRepository;
import com.abada.engine.persistence.repository.ProjectMemberRepository;
import com.abada.engine.persistence.repository.ProjectProcessDocumentRepository;
import com.abada.engine.persistence.repository.ProjectRepository;
import com.abada.engine.persistence.entity.ProjectFolderEntity;
import java.time.Instant;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProjectService {
    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final PrincipalRepository principals;
    private final ProjectProcessDocumentRepository documents;
    private final ProjectFolderRepository folders;
    private final ProjectAccessService access;

    public ProjectService(ProjectRepository projects, ProjectMemberRepository members,
            PrincipalRepository principals, ProjectProcessDocumentRepository documents,
            ProjectFolderRepository folders, ProjectAccessService access) {
        this.projects = projects;
        this.members = members;
        this.principals = principals;
        this.documents = documents;
        this.folders = folders;
        this.access = access;
    }

    @Transactional
    public ProjectEntity create(String slug, String name, String description) {
        String normalizedSlug = normalizeSlug(slug);
        if (projects.findBySlug(normalizedSlug).isPresent()) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.CONCURRENT_MODIFICATION,
                    "Project slug already exists: " + normalizedSlug);
        }
        validateName(name);
        var identity = access.identity();
        if (identity.principalId() == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, ApiErrorCode.AUTHENTICATION_REQUIRED,
                    "A stable principal is required to create a project");
        }
        Instant now = Instant.now();
        ProjectEntity project = new ProjectEntity();
        project.setSlug(normalizedSlug);
        project.setName(name.strip());
        project.setDescription(normalizeDescription(description));
        project.setCreatedBy(identity.username());
        project.setCreatedAt(now);
        project.setUpdatedAt(now);
        project = projects.save(project);

        ProjectMemberEntity owner = new ProjectMemberEntity();
        owner.setProjectId(project.getId());
        owner.setPrincipalId(identity.principalId());
        owner.setRoles(EnumSet.of(Role.OWNER, Role.MAINTAINER, Role.OPERATOR, Role.VIEWER));
        owner.setCreatedAt(now);
        owner.setCreatedBy(identity.username());
        members.save(owner);
        seedDefaultFolders(project.getId(), now);
        return project;
    }

    private void seedDefaultFolders(String projectId, Instant now) {
        for (String name : ProjectTreeService.SYSTEM_ROOT_FOLDER_NAMES) {
            ProjectFolderEntity folder = new ProjectFolderEntity();
            folder.setProjectId(projectId);
            folder.setName(name);
            folder.setSystemFolder(true);
            folder.setCreatedAt(now);
            folder.setUpdatedAt(now);
            folders.save(folder);
        }
    }

    @Transactional(readOnly = true)
    public List<ProjectEntity> accessibleProjects() {
        if (access.isGlobalAdmin()) return projects.findAll().stream()
                .sorted(java.util.Comparator.comparing(ProjectEntity::getName)).toList();
        String principalId = access.identity().principalId();
        if (principalId == null) return List.of();
        return members.findByPrincipalId(principalId).stream()
                .map(member -> projects.findById(member.getProjectId()).orElse(null))
                .filter(java.util.Objects::nonNull)
                .sorted(java.util.Comparator.comparing(ProjectEntity::getName)).toList();
    }

    @Transactional
    public ProjectEntity update(String projectId, long expectedVersion, String name, String description) {
        ProjectEntity project = access.requireActive(projectId, Role.OWNER);
        if (project.getEntityVersion() != expectedVersion) throw conflict();
        validateName(name);
        project.setName(name.strip());
        project.setDescription(normalizeDescription(description));
        project.setUpdatedAt(Instant.now());
        return projects.save(project);
    }

    @Transactional
    public ProjectEntity setArchived(String projectId, long expectedVersion, boolean archived) {
        ProjectEntity project = access.require(projectId, Role.OWNER);
        if (project.getEntityVersion() != expectedVersion) throw conflict();
        if (ProjectConstants.DEFAULT_PROJECT_ID.equals(projectId) && archived) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "The compatibility Default project cannot be archived");
        }
        project.setStatus(archived ? ProjectEntity.Status.ARCHIVED : ProjectEntity.Status.ACTIVE);
        project.setUpdatedAt(Instant.now());
        return projects.save(project);
    }

    @Transactional(readOnly = true)
    public List<ProjectMemberEntity> members(String projectId) {
        access.require(projectId, Role.OWNER);
        return members.findByProjectIdOrderByCreatedAtAsc(projectId);
    }

    @Transactional
    public ProjectMemberEntity putMember(String projectId, String principalId, Long expectedVersion,
            Set<Role> roles, Set<String> reviewLanes) {
        access.requireActive(projectId, Role.OWNER);
        PrincipalEntity principal = principals.findById(principalId).orElseThrow(() ->
                new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                        "Principal is unknown; the user must sign in before being added"));
        if (roles == null || roles.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "At least one project role is required");
        }
        ProjectMemberEntity member = members.findByProjectIdAndPrincipalId(projectId, principalId).orElse(null);
        if (member == null) {
            if (expectedVersion != null && expectedVersion != 0) throw conflict();
            member = new ProjectMemberEntity();
            member.setProjectId(projectId);
            member.setPrincipalId(principal.getId());
            member.setCreatedAt(Instant.now());
            member.setCreatedBy(access.identity().username());
        } else if (expectedVersion != null && member.getEntityVersion() != expectedVersion) {
            throw conflict();
        }
        if (member.getRoles().contains(Role.OWNER) && !roles.contains(Role.OWNER)
                && members.countByProjectIdAndRole(projectId, Role.OWNER) <= 1) {
            throw lastOwner();
        }
        Set<String> lanes = new LinkedHashSet<>();
        if (reviewLanes != null) reviewLanes.forEach(lane -> lanes.add(access.normalizeLane(lane)));
        if (!roles.contains(Role.REVIEWER) && !lanes.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Review lanes require the REVIEWER role");
        }
        member.setRoles(EnumSet.copyOf(roles));
        member.setReviewLanes(lanes);
        return members.save(member);
    }

    @Transactional
    public void removeMember(String projectId, String principalId) {
        access.requireActive(projectId, Role.OWNER);
        ProjectMemberEntity member = members.findByProjectIdAndPrincipalId(projectId, principalId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "Project member not found"));
        if (member.getRoles().contains(Role.OWNER)
                && members.countByProjectIdAndRole(projectId, Role.OWNER) <= 1) throw lastOwner();
        members.delete(member);
    }

    public long processCount(String projectId) { return documents.countByProjectId(projectId); }

    private String normalizeSlug(String value) {
        String slug = value == null ? "" : value.strip().toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9-]", "-").replaceAll("-+", "-")
                .replaceAll("^-|-$", "");
        if (!slug.matches("[a-z0-9][a-z0-9-]{0,127}")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Project slug must contain 1 to 128 lowercase letters, digits or dashes");
        }
        return slug;
    }

    private void validateName(String name) {
        if (name == null || name.isBlank() || name.strip().length() > 255) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Project name must contain 1 to 255 characters");
        }
    }

    private String normalizeDescription(String description) {
        String value = description == null ? "" : description.strip();
        if (value.length() > 4000) throw new ApiException(HttpStatus.BAD_REQUEST,
                ApiErrorCode.INVALID_REQUEST, "Project description cannot exceed 4000 characters");
        return value;
    }

    private InsightConflictException conflict() {
        return new InsightConflictException("Project or membership changed concurrently; reload before saving");
    }

    private ApiException lastOwner() {
        return new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                "A project must retain at least one owner");
    }
}
