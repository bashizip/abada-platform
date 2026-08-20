package com.abada.engine.project;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.WorkerCapabilityEntity;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.persistence.repository.WorkerCapabilityRepository;
import com.abada.engine.security.Identity;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Global, project-agnostic worker registration. A worker principal with the
 * Abada worker role registers the topics (and optionally the models) it can
 * serve once, engine-wide; fetch-and-lock without a projectId is then
 * authorized against these capabilities instead of per-project bindings.
 */
@Service
public class WorkerCapabilityService {

    private final WorkerCapabilityRepository capabilities;
    private final PrincipalRepository principals;
    private final ExternalTaskRepository externalTasks;
    private final ProjectWorkerService projectWorkers;
    private final ProjectAccessService access;
    private final FirstPartyWorkersProperties workerProperties;
    private final List<String> allowedModels;

    public WorkerCapabilityService(WorkerCapabilityRepository capabilities,
            PrincipalRepository principals, ExternalTaskRepository externalTasks,
            ProjectWorkerService projectWorkers,
            ProjectAccessService access, FirstPartyWorkersProperties workerProperties,
            @Value("${abada.agent.allowed-models:}") List<String> allowedModels) {
        this.capabilities = capabilities;
        this.principals = principals;
        this.externalTasks = externalTasks;
        this.projectWorkers = projectWorkers;
        this.access = access;
        this.workerProperties = workerProperties;
        this.allowedModels = allowedModels == null ? List.of() : allowedModels;
    }

    /**
     * Upserts the calling principal's global capabilities for the requested
     * topics. Only service principals can register as global workers.
     */
    @Transactional
    public List<WorkerCapabilityEntity> register(List<String> topics, List<String> models) {
        Identity identity = access.identity();
        PrincipalEntity principal = principals.findById(identity.principalId())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED,
                        ApiErrorCode.AUTHENTICATION_REQUIRED, "Worker principal not found"));
        if (principal.getPrincipalType() != PrincipalEntity.Type.SERVICE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Only service principals can register as global workers");
        }
        List<String> normalizedTopics = normalizeTopics(topics);
        if (normalizedTopics.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "At least one non-blank topic is required");
        }
        List<String> normalizedModels = normalizeModels(models);
        for (String model : normalizedModels) {
            if (!allowedModels.contains(model)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                        "Model is not in the engine allow-list: " + model);
            }
        }
        Instant now = Instant.now();
        for (String topic : normalizedTopics) {
            var capability = capabilities.findByPrincipalIdAndTopic(identity.principalId(), topic)
                    .orElseGet(WorkerCapabilityEntity::new);
            capability.setPrincipalId(identity.principalId());
            capability.setTopic(topic);
            capability.setModels(String.join(",", normalizedModels));
            if (capability.getCreatedAt() == null) capability.setCreatedAt(now);
            if (capability.getCreatedBy() == null) capability.setCreatedBy(identity.username());
            capabilities.save(capability);
        }
        return capabilities.findByPrincipalId(identity.principalId());
    }

    /** Removes the calling principal's global capabilities for the given topics. */
    @Transactional
    public void unregister(List<String> topics) {
        for (String topic : normalizeTopics(topics)) {
            capabilities.findByPrincipalIdAndTopic(access.identity().principalId(), topic)
                    .ifPresent(capabilities::delete);
        }
    }

    @Transactional(readOnly = true)
    public List<WorkerCapabilityEntity> capabilitiesForCurrentWorker() {
        return capabilities.findByPrincipalId(access.identity().principalId());
    }

    /**
     * Authorizes a project-agnostic fetch: every requested topic must be
     * covered by a global capability of the calling principal.
     */
    @Transactional(readOnly = true)
    public void requireGlobalWorker(List<String> topics) {
        String principalId = access.identity().principalId();
        List<String> normalized = normalizeTopics(topics);
        if (normalized.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "At least one non-blank topic is required");
        }
        if (principalId == null) {
            throw new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                    "Worker is not registered for the requested topics");
        }
        Map<String, WorkerCapabilityEntity> byTopic = capabilities.findByPrincipalId(principalId).stream()
                .collect(Collectors.toMap(WorkerCapabilityEntity::getTopic, Function.identity()));
        for (String topic : normalized) {
            if (!byTopic.containsKey(topic)) {
                throw new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                        "Worker is not registered for topic " + topic);
            }
        }
    }

    /** The models a worker registered for a topic; empty means all models. */
    @Transactional(readOnly = true)
    public List<String> modelsFor(String principalId, String topic) {
        return capabilities.findByPrincipalIdAndTopic(principalId, topic)
                .map(capability -> splitModels(capability.getModels()))
                .orElse(List.of());
    }

    /**
     * Authorizes task-scoped worker mutations (complete/failure/heartbeat):
     * a global capability covering the task topic, or a per-project binding
     * covering it in the task's project.
     */
    public void requireWorkerForTask(String taskId) {
        ExternalTaskEntity task = externalTasks.findById(taskId).orElseThrow(() -> new ApiException(
                HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "External task not found"));
        String principalId = access.identity().principalId();
        if (principalId == null) {
            throw new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                    "Worker is not registered for this task topic");
        }
        boolean global = capabilities.findByPrincipalIdAndTopic(principalId, task.getTopicName())
                .isPresent();
        if (!global) {
            projectWorkers.requireCurrentWorkerForTask(taskId);
        }
    }

    /**
     * Registers global capabilities for every configured first-party worker
     * whose principal has been observed. Idempotent and safe on multi-replica
     * startups: a concurrent insert collides with the unique (principal, topic)
     * constraint, which callers may swallow and retry.
     */
    @Transactional
    public void ensureFirstPartyCapabilities() {
        Instant now = Instant.now();
        for (FirstPartyWorkersProperties.FirstPartyWorker worker : workerProperties.getFirstParty()) {
            principals.findFirstByUsernameIgnoreCase(worker.username()).ifPresent(principal -> {
                for (String topic : normalizeTopics(worker.topics())) {
                    capabilities.findByPrincipalIdAndTopic(principal.getId(), topic)
                            .orElseGet(() -> {
                                WorkerCapabilityEntity capability = new WorkerCapabilityEntity();
                                capability.setPrincipalId(principal.getId());
                                capability.setTopic(topic);
                                capability.setModels(String.join(",", normalizeModels(worker.models())));
                                capability.setCreatedAt(now);
                                capability.setCreatedBy(principal.getUsername());
                                return capabilities.save(capability);
                            });
                }
            });
        }
    }

    private static List<String> normalizeTopics(List<String> topics) {
        return topics == null ? List.of() : topics.stream().map(String::strip)
                .filter(value -> !value.isBlank()).distinct().sorted().toList();
    }

    private static List<String> normalizeModels(List<String> models) {
        return models == null ? List.of() : models.stream().map(String::strip)
                .filter(value -> !value.isBlank()).distinct().sorted().toList();
    }

    private static List<String> splitModels(String models) {
        if (models == null || models.isBlank()) return List.of();
        return Arrays.stream(models.split(",")).map(String::strip)
                .filter(value -> !value.isBlank()).toList();
    }
}