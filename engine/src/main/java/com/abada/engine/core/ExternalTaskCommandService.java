package com.abada.engine.core;

import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.dto.ExtendLockRequest;
import com.abada.engine.dto.ExternalTaskFailureDto;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import com.abada.engine.dto.ExternalTaskBpmnErrorRequest;
import com.abada.engine.insight.InsightFactWriter;

@Service
public class ExternalTaskCommandService {
    private final ExternalTaskRepository repository;
    private final AbadaEngine engine;
    private final ActivityHistoryService history;
    private final InsightFactWriter insightFactWriter;

    public ExternalTaskCommandService(ExternalTaskRepository repository, AbadaEngine engine,
            ActivityHistoryService history, InsightFactWriter insightFactWriter) {
        this.repository = repository;
        this.engine = engine;
        this.history = history;
        this.insightFactWriter = insightFactWriter;
    }

    @AtomicRuntimeCommand
    public List<LockedExternalTask> fetchAndLock(FetchAndLockRequest request) {
        validateFetch(request);
        Instant now = Instant.now();
        List<LockedExternalTask> locked = new ArrayList<>();
        while (locked.size() < request.effectiveMaxTasks()) {
            boolean acquired = false;
            for (String topic : request.topics()) {
                var available = request.projectId() == null
                        ? repository.findFirstAvailableForUpdate(topic, now)
                        : repository.findFirstAvailableForProjectForUpdate(request.projectId(), topic, now);
                if (available.isEmpty()) continue;

                ExternalTaskEntity task = available.get();
                task.setWorkerId(request.workerId());
                task.setStatus(ExternalTaskEntity.Status.LOCKED);
                task.setLockExpirationTime(now.plusMillis(request.lockDuration()));
                repository.save(task);

                ProcessInstance instance = requireInstance(task);
                var serviceTask = instance.getDefinition().getServiceTask(task.getActivityId());
                history.record("EXTERNAL_TASK_LOCKED", instance, task.getActivityId(),
                        Map.of("externalTaskId", task.getId(), "workerId", request.workerId(), "topic", topic));
                locked.add(new LockedExternalTask(task.getId(), task.getTopicName(), instance.getVariables(),
                        task.getProcessInstanceId(), task.getActivityId(), task.getRetries(),
                        task.getLockExpirationTime(), task.getTraceParent(), "1",
                        serviceTask == null ? null : serviceTask.agentWork()));
                acquired = true;
                if (locked.size() >= request.effectiveMaxTasks()) break;
            }
            if (!acquired) break;
        }
        return List.copyOf(locked);
    }

    @AtomicRuntimeCommand
    public void complete(String id, Map<String, Object> variables) {
        complete(id, null, variables);
    }

    @AtomicRuntimeCommand
    public void complete(String id, String workerId, Map<String, Object> variables) {
        ExternalTaskEntity task = loadForUpdate(id);
        if (task.getStatus() == ExternalTaskEntity.Status.COMPLETED) return;
        requireOwnedActiveLock(task, workerId);

        task.setStatus(ExternalTaskEntity.Status.COMPLETED);
        task.setLockExpirationTime(null);
        repository.save(task);
        engine.resumeFromEvent(task.getProcessInstanceId(), task.getActivityId(), variables);
        history.record("EXTERNAL_TASK_COMPLETED", requireInstance(task), task.getActivityId(),
                Map.of("externalTaskId", id, "workerId", valueOrEmpty(task.getWorkerId())));
        recordExternalTaskFact(task, true);
    }

    @AtomicRuntimeCommand
    public void handleFailure(String id, ExternalTaskFailureDto failure) {
        ExternalTaskEntity task = loadForUpdate(id);
        requireOwnedActiveLock(task, failure.workerId());

        task.setExceptionMessage(failure.errorMessage());
        task.setExceptionStacktrace(failure.errorDetails());
        task.setRetries(failure.retries());
        if (failure.retries() != null && failure.retries() == 0) {
            task.setStatus(ExternalTaskEntity.Status.FAILED);
            task.setLockExpirationTime(null);
        } else {
            boolean delayed = failure.retryTimeout() != null && failure.retryTimeout() > 0;
            task.setStatus(delayed ? ExternalTaskEntity.Status.LOCKED : ExternalTaskEntity.Status.OPEN);
            task.setLockExpirationTime(delayed ? Instant.now().plusMillis(failure.retryTimeout()) : null);
        }
        task.setWorkerId(null);
        repository.save(task);
        history.record("EXTERNAL_TASK_FAILED", requireInstance(task), task.getActivityId(),
                Map.of("externalTaskId", id, "retries", failure.retries() == null ? -1 : failure.retries()));
        if (task.getStatus() == ExternalTaskEntity.Status.FAILED) {
            recordExternalTaskFact(task, false);
        }
    }

    @AtomicRuntimeCommand
    public void extendLock(String id, ExtendLockRequest request) {
        ExternalTaskEntity task = loadForUpdate(id);
        requireOwnedActiveLock(task, request.workerId());
        if (request.lockDuration() < 1 || request.lockDuration() > 3_600_000) {
            throw new ProcessEngineException("lockDuration must be between 1 and 3600000 milliseconds");
        }
        task.setLockExpirationTime(Instant.now().plusMillis(request.lockDuration()));
        repository.save(task);
        history.record("EXTERNAL_TASK_LOCK_EXTENDED", requireInstance(task), task.getActivityId(),
                Map.of("externalTaskId", id, "workerId", request.workerId()));
    }

    @AtomicRuntimeCommand
    public void setRetries(String id, int retries) {
        ExternalTaskEntity task = loadForUpdate(id);
        task.setRetries(retries);
        task.setStatus(ExternalTaskEntity.Status.OPEN);
        task.setWorkerId(null);
        task.setLockExpirationTime(null);
        repository.save(task);
        history.record("EXTERNAL_TASK_RETRIES_SET", requireInstance(task), task.getActivityId(),
                Map.of("externalTaskId", id, "retries", retries));
    }

    @AtomicRuntimeCommand
    public void handleBpmnError(String id, ExternalTaskBpmnErrorRequest request) {
        if (request.errorCode() == null || request.errorCode().isBlank()) {
            throw new ProcessEngineException("BPMN errorCode is required");
        }
        ExternalTaskEntity task = loadForUpdate(id);
        requireOwnedActiveLock(task, request.workerId());
        task.setStatus(ExternalTaskEntity.Status.BPMN_ERROR);
        task.setBpmnErrorCode(request.errorCode());
        task.setBpmnErrorMessage(request.errorMessage());
        task.setWorkerId(null);
        task.setLockExpirationTime(null);
        repository.save(task);

        if (!request.effectiveVariables().isEmpty()) {
            engine.updateProcessVariables(task.getProcessInstanceId(), request.effectiveVariables());
        }
        engine.failProcess(task.getProcessInstanceId());
        history.record("EXTERNAL_TASK_BPMN_ERROR", requireInstance(task), task.getActivityId(),
                Map.of("externalTaskId", id, "errorCode", request.errorCode(),
                        "errorMessage", request.errorMessage() == null ? "" : request.errorMessage()));
        recordExternalTaskFact(task, false);
    }

    /** Terminal fact for the analyzed signal; skips legacy rows without a known start. */
    private void recordExternalTaskFact(ExternalTaskEntity task, boolean succeeded) {
        if (task.getCreatedAt() == null) {
            return;
        }
        ProcessInstance instance = engine.getProcessInstanceById(task.getProcessInstanceId());
        if (instance == null) {
            return;
        }
        String definitionKey = instance.getDefinition().getId();
        String deploymentId = instance.getProcessDefinitionDeploymentId();
        Instant endedAt = Instant.now();
        if (succeeded) {
            insightFactWriter.recordExternalTaskSuccess(instance.getProjectId(), task.getId(), definitionKey,
                    deploymentId,
                    task.getProcessInstanceId(), task.getActivityId(), task.getTopicName(),
                    task.getCreatedAt(), endedAt);
        } else {
            insightFactWriter.recordExternalTaskFailure(instance.getProjectId(), task.getId(), definitionKey,
                    deploymentId,
                    task.getProcessInstanceId(), task.getActivityId(), task.getTopicName(),
                    task.getCreatedAt(), endedAt);
        }
    }

    private ExternalTaskEntity loadForUpdate(String id) {
        return repository.findByIdForUpdate(id)
                .orElseThrow(() -> new ProcessEngineException("External task not found: " + id));
    }

    private void requireOwnedActiveLock(ExternalTaskEntity task, String workerId) {
        if (task.getStatus() != ExternalTaskEntity.Status.LOCKED || task.getLockExpirationTime() == null) {
            throw new ProcessEngineException("External task is not locked: " + task.getId());
        }
        if (task.getLockExpirationTime().isBefore(Instant.now())) {
            throw new ProcessEngineException("External task lock has expired: " + task.getId());
        }
        if (workerId != null && !workerId.equals(task.getWorkerId())) {
            throw new ProcessEngineException("Worker does not own external task lock: " + task.getId());
        }
    }

    private void validateFetch(FetchAndLockRequest request) {
        if (request.workerId() == null || request.workerId().isBlank()) {
            throw new ProcessEngineException("workerId is required");
        }
        if (request.topics() == null || request.topics().isEmpty() || request.topics().stream().anyMatch(String::isBlank)) {
            throw new ProcessEngineException("At least one non-blank topic is required");
        }
        if (request.lockDuration() < 1 || request.lockDuration() > 3_600_000) {
            throw new ProcessEngineException("lockDuration must be between 1 and 3600000 milliseconds");
        }
        if (request.effectiveMaxTasks() < 1 || request.effectiveMaxTasks() > 50) {
            throw new ProcessEngineException("maxTasks must be between 1 and 50");
        }
    }

    private ProcessInstance requireInstance(ExternalTaskEntity task) {
        ProcessInstance instance = engine.getProcessInstanceById(task.getProcessInstanceId());
        if (instance == null) {
            throw new IllegalStateException("External task references missing process instance: " + task.getProcessInstanceId());
        }
        return instance;
    }

    private String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }
}
