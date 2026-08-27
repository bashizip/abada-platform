package com.abada.engine.project;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.persistence.entity.ProjectEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.ProjectMemberRepository;
import com.abada.engine.persistence.repository.ProjectRepository;
import com.abada.engine.security.AbadaRoles;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

@Service
public class ProjectAccessService {
    private final ProjectRepository projects;
    private final ProjectMemberRepository members;

    public ProjectAccessService(ProjectRepository projects, ProjectMemberRepository members) {
        this.projects = projects;
        this.members = members;
    }

    public Identity identity() {
        return IdentityContext.get().orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED,
                ApiErrorCode.AUTHENTICATION_REQUIRED, "Authentication is required"));
    }

    public ProjectEntity requireVisible(String projectId) {
        ProjectEntity project = projects.findById(projectId).orElseThrow(this::notFound);
        if (!isGlobalAdmin() && membership(projectId) == null) throw notFound();
        return project;
    }

    public ProjectEntity requireActive(String projectId, Role... roles) {
        ProjectEntity project = require(projectId, roles);
        if (project.getStatus() != ProjectEntity.Status.ACTIVE) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "Project is archived and cannot be modified");
        }
        return project;
    }

    public ProjectEntity require(String projectId, Role... roles) {
        ProjectEntity project = projects.findById(projectId).orElseThrow(this::notFound);
        if (isGlobalAdmin()) return project;
        ProjectMemberEntity member = membership(projectId);
        Set<Role> granted = member == null ? Set.of() : member.getRoles();
        if (Arrays.stream(roles).noneMatch(granted::contains)) throw notFound();
        return project;
    }

    /** Business review is never bypassed by global administration. */
    public ProjectMemberEntity requireReviewLane(String projectId, String lane) {
        ProjectMemberEntity member = membership(projectId);
        String normalized = normalizeLane(lane);
        if (member == null || !member.getRoles().contains(Role.REVIEWER)
                || !member.getReviewLanes().contains(normalized)) {
            throw new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                    "Reviewer is not assigned to required project lane " + normalized);
        }
        return member;
    }

    public ProjectMemberEntity membership(String projectId) {
        Identity identity = identity();
        if (identity.principalId() == null) return null;
        return members.findByProjectIdAndPrincipalId(projectId, identity.principalId()).orElse(null);
    }

    public boolean isGlobalAdmin() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getAuthorities().stream()
                .anyMatch(authority -> AbadaRoles.ADMIN.equals(authority.getAuthority()))) return true;
        return IdentityContext.get().map(Identity::groups).orElseGet(java.util.List::of).stream()
                .map(value -> value.strip().replaceFirst("^/", "").replace('-', '_').toUpperCase(Locale.ROOT))
                .anyMatch("ABADA_ADMIN"::equals);
    }

    public String normalizeLane(String value) {
        String lane = value == null ? "" : value.strip().toUpperCase(Locale.ROOT)
                .replaceAll("[^A-Z0-9_-]", "_");
        if (lane.isBlank() || lane.length() > 128) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Review lane must contain 1 to 128 alphanumeric, dash or underscore characters");
        }
        return lane;
    }

    public String normalizeTaskGroup(String value) {
        String group = value == null ? "" : value.strip();
        if (group.isBlank() || group.length() > 128) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Task group must contain 1 to 128 non-blank characters");
        }
        return group;
    }

    private ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                "Project resource not found");
    }
}
