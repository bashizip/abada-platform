package com.abada.engine.project;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.entity.ProjectWorkerBindingEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.persistence.repository.ProjectWorkerBindingRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.ProcessInstanceRepository;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProjectWorkerService {
    private final ProjectWorkerBindingRepository bindings;
    private final PrincipalRepository principals;
    private final ProjectAccessService access;
    private final ExternalTaskRepository externalTasks;
    private final ProcessInstanceRepository processInstances;
    private final List<FirstPartyWorkersProperties.FirstPartyWorker> firstPartyWorkers;

    public ProjectWorkerService(ProjectWorkerBindingRepository bindings, PrincipalRepository principals,
            ProjectAccessService access, ExternalTaskRepository externalTasks,
            ProcessInstanceRepository processInstances, FirstPartyWorkersProperties workerProperties) {
        this.bindings = bindings;
        this.principals = principals;
        this.access = access;
        this.externalTasks = externalTasks;
        this.processInstances = processInstances;
        this.firstPartyWorkers = workerProperties.getFirstParty();
    }

    /**
     * Binds every configured first-party worker to the given project. Idempotent
     * and safe to run on project creation and on engine startup.
     */
    @Transactional
    public void ensureFirstPartyBindings(String projectId) {
        for (FirstPartyWorkersProperties.FirstPartyWorker worker : firstPartyWorkers) {
            principals.findFirstByUsernameIgnoreCase(worker.username()).ifPresent(principal ->
                    bindings.findByProjectIdAndPrincipalId(projectId, principal.getId())
                            .orElseGet(() -> {
                                ProjectWorkerBindingEntity binding = new ProjectWorkerBindingEntity();
                                binding.setProjectId(projectId);
                                binding.setPrincipalId(principal.getId());
                                binding.setTopics(String.join(",", normalize(worker.topics())));
                                binding.setCreatedAt(Instant.now());
                                binding.setCreatedBy(principal.getUsername());
                                return bindings.save(binding);
                            }));
        }
    }

    @Transactional(readOnly = true)
    public List<ProjectWorkerBindingEntity> list(String projectId) {
        access.require(projectId, Role.OWNER);
        return bindings.findByProjectId(projectId);
    }

    @Transactional
    public ProjectWorkerBindingEntity put(String projectId, String principalId, List<String> topics) {
        access.requireActive(projectId, Role.OWNER);
        var principal = principals.findById(principalId).orElseThrow(() -> new ApiException(
                HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "Service principal not found"));
        if (principal.getPrincipalType() != com.abada.engine.persistence.entity.PrincipalEntity.Type.SERVICE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Only service principals can be bound as project workers");
        }
        List<String> normalized = normalize(topics);
        var binding = bindings.findByProjectIdAndPrincipalId(projectId, principalId)
                .orElseGet(ProjectWorkerBindingEntity::new);
        binding.setProjectId(projectId);
        binding.setPrincipalId(principalId);
        binding.setTopics(String.join(",", normalized));
        if (binding.getCreatedAt() == null) binding.setCreatedAt(Instant.now());
        if (binding.getCreatedBy() == null) binding.setCreatedBy(access.identity().username());
        return bindings.save(binding);
    }

    public void requireCurrentWorker(String projectId, List<String> topics) {
        String principalId = access.identity().principalId();
        var binding = principalId == null ? null
                : bindings.findByProjectIdAndPrincipalId(projectId, principalId).orElse(null);
        if (binding == null) throw new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                "Worker is not bound to this project");
        List<String> allowed = Arrays.stream(binding.getTopics().split(",")).toList();
        if (topics == null || topics.isEmpty() || !allowed.containsAll(normalize(topics))) {
            throw new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                    "Worker requested a topic outside its project binding");
        }
    }

    public void requireCurrentWorkerForTask(String taskId) {
        var task = externalTasks.findById(taskId).orElseThrow(() -> new ApiException(
                HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "External task not found"));
        var instance = processInstances.findById(task.getProcessInstanceId()).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "External task project not found"));
        requireCurrentWorker(instance.getProjectId(), List.of(task.getTopicName()));
    }

    private List<String> normalize(List<String> topics) {
        return topics == null ? List.of() : topics.stream().map(String::strip)
                .filter(value -> !value.isBlank()).distinct().sorted().toList();
    }
}
