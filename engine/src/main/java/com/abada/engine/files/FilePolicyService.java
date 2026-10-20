package com.abada.engine.files;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.persistence.entity.ProjectEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.ProjectRepository;
import com.abada.engine.project.ProjectAccessService;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** A project's file retention (V42): how long a finished instance keeps its attached files. */
@Service
public class FilePolicyService {
    public static final int MAX_RETENTION_DAYS = 3650;

    private final ProjectAccessService access;
    private final ProjectRepository projects;
    private final ActivityHistoryService history;

    public FilePolicyService(ProjectAccessService access, ProjectRepository projects, ActivityHistoryService history) {
        this.access = access;
        this.projects = projects;
        this.history = history;
    }

    /** {@code retentionDays} null keeps attached files for as long as their instance exists. */
    public record PolicyView(Integer retentionDays) {
    }

    @Transactional(readOnly = true)
    public PolicyView policy(String projectId) {
        return new PolicyView(access.requireVisible(projectId).getFileRetentionDays());
    }

    /** Owners only; applies to every finished instance from the next sweep. */
    @Transactional
    public PolicyView setPolicy(String projectId, Integer retentionDays) {
        ProjectEntity project = access.requireActive(projectId, Role.OWNER);
        if (retentionDays != null && (retentionDays < 1 || retentionDays > MAX_RETENTION_DAYS)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "retentionDays is null (keep) or between 1 and " + MAX_RETENTION_DAYS);
        }
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("projectId", projectId);
        details.put("fromRetentionDays", project.getFileRetentionDays());
        details.put("toRetentionDays", retentionDays);
        project.setFileRetentionDays(retentionDays);
        project.setUpdatedAt(Instant.now());
        projects.save(project);
        history.record("FILE_POLICY_CHANGED", null, null, null, details);
        return new PolicyView(retentionDays);
    }
}
