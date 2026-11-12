package com.abada.engine.files;

import com.abada.engine.api.ApiException;
import com.abada.engine.persistence.entity.ProcessFileEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.project.ProjectAccessService;
import com.abada.engine.project.TaskGroupResolver;
import com.abada.engine.security.AbadaRoles;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import java.util.List;
import java.util.Set;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Who may read an attached file, beyond its uploader: the people who may read
 * its instance (a project member with the operations read permission, as for
 * {@code GET /v1/projects/{p}/instances/**}), and the users of the instance's
 * human tasks (assignee or candidate), who see the files a previous step added.
 */
@Service
public class FileReadAccess {
    private static final Set<String> INSTANCE_READERS = Set.of("SCOPE_operations:read", AbadaRoles.OPERATOR,
            AbadaRoles.ADMIN);

    private final ProjectAccessService access;
    private final TaskRepository tasks;
    private final TaskGroupResolver groups;

    public FileReadAccess(ProjectAccessService access, TaskRepository tasks, TaskGroupResolver groups) {
        this.access = access;
        this.tasks = tasks;
        this.groups = groups;
    }

    @Transactional(readOnly = true)
    public boolean mayRead(ProcessFileEntity file) {
        Identity identity = IdentityContext.get().orElse(null);
        if (identity == null) return false;
        if (instanceReader(file.getProjectId())) return true;
        String user = identity.username();
        List<String> effective = groups.effectiveGroups(file.getProjectId(), identity.principalId(),
                identity.groups() == null ? List.of() : List.copyOf(identity.groups()));
        for (TaskEntity task : tasks.findByProcessInstanceId(file.getInstanceId())) {
            if (user != null && user.equals(task.getAssignee())) return true;
            if (task.getCandidateUsers().contains(user)) return true;
            if (effective != null && effective.stream().anyMatch(task.getCandidateGroups()::contains)) return true;
        }
        return false;
    }

    private boolean instanceReader(String projectId) {
        try {
            access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        } catch (ApiException notMember) {
            return false;
        }
        if (access.isGlobalAdmin()) return true;
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getAuthorities().stream()
                .anyMatch(authority -> INSTANCE_READERS.contains(authority.getAuthority()))) return true;
        return IdentityContext.get().map(Identity::groups).orElseGet(List::of).stream()
                .map(AbadaRoles::fromGroup).filter(java.util.Objects::nonNull).anyMatch(INSTANCE_READERS::contains);
    }
}
