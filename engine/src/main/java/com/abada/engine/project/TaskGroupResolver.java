package com.abada.engine.project;

import com.abada.engine.persistence.entity.ProjectMemberEntity;
import com.abada.engine.persistence.repository.ProjectMemberRepository;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Resolves the effective candidate-group set for a user within a project by
 * merging the user's identity groups (JWT claim / X-Groups header) with their
 * project-scoped task groups.
 *
 * <p>When a user has no project membership the identity groups are returned
 * unchanged, so existing deployments that rely solely on Keycloak/IdP groups
 * are unaffected.</p>
 */
@Component
public class TaskGroupResolver {

    private final ProjectMemberRepository members;

    public TaskGroupResolver(ProjectMemberRepository members) {
        this.members = members;
    }

    /**
     * Effective groups for the user in the given project.
     */
    public List<String> effectiveGroups(String projectId, String principalId,
            List<String> identityGroups) {
        if (principalId == null || principalId.isBlank()) {
            return identityGroups == null ? List.of() : List.copyOf(identityGroups);
        }
        return members.findByProjectIdAndPrincipalId(projectId, principalId)
                .map(member -> merge(identityGroups, member.getTaskGroups()))
                .orElseGet(() -> identityGroups == null ? List.of() : List.copyOf(identityGroups));
    }

    /**
     * Union of identity groups with task groups across all of the user's
     * project memberships.  Used by the cross-project task inbox.
     */
    public List<String> globalEffectiveGroups(String principalId, List<String> identityGroups) {
        if (principalId == null || principalId.isBlank()) {
            return identityGroups == null ? List.of() : List.copyOf(identityGroups);
        }
        List<ProjectMemberEntity> all = members.findByPrincipalId(principalId);
        if (all.isEmpty()) {
            return identityGroups == null ? List.of() : List.copyOf(identityGroups);
        }
        Set<String> merged = new LinkedHashSet<>(
                identityGroups == null ? List.of() : identityGroups);
        for (ProjectMemberEntity m : all) {
            merged.addAll(m.getTaskGroups());
        }
        return List.copyOf(merged);
    }

    private List<String> merge(List<String> identityGroups, Set<String> taskGroups) {
        if (taskGroups == null || taskGroups.isEmpty()) {
            return identityGroups == null ? List.of() : List.copyOf(identityGroups);
        }
        Set<String> merged = new LinkedHashSet<>(
                identityGroups == null ? List.of() : identityGroups);
        merged.addAll(taskGroups);
        return List.copyOf(merged);
    }
}
