package com.abada.engine.core;

import com.abada.engine.api.ApiException;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.AgentAttemptMetadata;
import com.abada.engine.dto.ExtendLockRequest;
import com.abada.engine.dto.ExternalTaskFailureDto;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.core.model.ServiceTaskMeta;
import com.abada.engine.core.model.AgentWorkDescriptor;
import com.abada.engine.core.model.BoundaryMeta;
import com.abada.engine.core.agent.AgentInputs;
import com.abada.engine.core.agent.AgentOutputValidator;
import com.abada.engine.parser.AplParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import com.abada.engine.dto.ExternalTaskBpmnErrorRequest;
import com.abada.engine.insight.InsightFactWriter;
import com.abada.engine.project.ProjectAccessService;
import com.abada.engine.project.WorkerCapabilityService;

@Service
public class ExternalTaskCommandService {
    private final ExternalTaskRepository repository;
    private final AbadaEngine engine;
    private final ActivityHistoryService history;
    private final InsightFactWriter insightFactWriter;
    private final ObjectMapper objectMapper;
    private final WorkerCapabilityService workerCapabilities;
    private final ProjectAccessService access;
    private final EntityManager entityManager;
    private final com.abada.engine.core.agent.AgentStepService agentSteps;
    private final com.abada.engine.persistence.repository.AgentStepRepository agentStepRepository;
    private final com.abada.engine.llm.ModelPriceService prices;
    private final com.abada.engine.observability.EngineMetrics metrics;

    /** Rate-limit waits allowed before one counts as a failed attempt, so waiting stays bounded. */
    private final int maxDeferrals;
    /** Longest wait between two deferred attempts. */
    private final java.time.Duration maxDeferralDelay;

    public ExternalTaskCommandService(ExternalTaskRepository repository, AbadaEngine engine,
            ActivityHistoryService history, InsightFactWriter insightFactWriter, ObjectMapper objectMapper,
            WorkerCapabilityService workerCapabilities, ProjectAccessService access, EntityManager entityManager,
            @org.springframework.beans.factory.annotation.Value("${abada.agent.max-deferrals:12}") int maxDeferrals,
            @org.springframework.beans.factory.annotation.Value("${abada.agent.max-deferral-delay:PT15M}")
            java.time.Duration maxDeferralDelay,
            com.abada.engine.core.agent.AgentStepService agentSteps,
            com.abada.engine.persistence.repository.AgentStepRepository agentStepRepository,
            com.abada.engine.llm.ModelPriceService prices,
            com.abada.engine.observability.EngineMetrics metrics) {
        this.agentSteps = agentSteps;
        this.agentStepRepository = agentStepRepository;
        this.prices = prices;
        this.metrics = metrics;
        this.maxDeferrals = maxDeferrals;
        this.maxDeferralDelay = maxDeferralDelay;
        this.repository = repository;
        this.engine = engine;
        this.history = history;
        this.insightFactWriter = insightFactWriter;
        this.objectMapper = objectMapper;
        this.workerCapabilities = workerCapabilities;
        this.access = access;
        this.entityManager = entityManager;
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
                        ? findAvailable(request, topic, now)
                        : repository.findFirstAvailableForProjectForUpdate(request.projectId(), topic, now);
                if (available.isEmpty()) continue;

                ExternalTaskEntity task = available.get();
                task.setWorkerId(request.workerId());
                task.setStatus(ExternalTaskEntity.Status.LOCKED);
                task.setLockExpirationTime(now.plusMillis(request.lockDuration()));
                repository.save(task);

                ProcessInstance instance = requireInstance(task);
                var serviceTask = instance.getDefinition().getServiceTask(task.getActivityId());
                AgentWorkDescriptor work = serviceTask == null ? null : serviceTask.agentWork();
                var journal = work == null ? null : agentSteps.prepareLock(task);
                if (journal != null && journal.blocked()) {
                    // A write with an unknown outcome stopped this task; a person decides, not a worker.
                    acquired = true;
                    continue;
                }
                history.record("EXTERNAL_TASK_LOCKED", instance, task.getActivityId(),
                        lockDetails(task, request.workerId(), topic, serviceTask));
                if (work != null && task.getModelOverride() != null) {
                    // An operator retried this task on another model; the definition is unchanged.
                    work = work.withModel(task.getModelOverride());
                }
                if (work != null && !work.tools().isEmpty()) {
                    work = work.withToolBindings(engine.toolBindings(instance, task.getActivityId()));
                }
                if (work != null) {
                    List<String> models = new ArrayList<>();
                    if (work.model() != null) models.add(work.model());
                    models.addAll(work.fallbackModels());
                    work = work.withPrices(prices.currentPrices(models));
                }
                Map<String, Object> payload = work != null
                        ? AgentInputs.resolve(work, instance.getVariables())
                        : instance.getVariables();
                locked.add(new LockedExternalTask(task.getId(), task.getTopicName(), payload,
                        task.getProcessInstanceId(), task.getActivityId(), task.getRetries(),
                        task.getLockExpirationTime(), task.getTraceParent(), "1",
                        work,
                        instance.getProjectId(), work == null ? null : task.getAttempt(),
                        journal == null ? null : journal.steps(),
                        journal == null ? null : journal.priorWrites()));
                acquired = true;
                if (locked.size() >= request.effectiveMaxTasks()) break;
            }
            if (!acquired) break;
        }
        return List.copyOf(locked);
    }

    /**
     * Global (project-agnostic) acquisition: when the worker's capability for
     * the topic lists models, only tasks whose required model is supported are
     * acquired; an empty model list means the worker serves all models.
     */
    private java.util.Optional<ExternalTaskEntity> findAvailable(FetchAndLockRequest request,
            String topic, Instant now) {
        List<String> models = List.of();
        try {
            models = workerCapabilities.modelsFor(access.identity().principalId(), topic);
        } catch (ApiException ignored) {
            // Unauthenticated acquisition (disabled security mode) is unrestricted.
        }
        if (models.isEmpty()) return repository.findFirstAvailableForUpdate(topic, now);
        return repository.findFirstAvailableForModelsForUpdate(topic, now, models);
    }

    @AtomicRuntimeCommand
    public void complete(String id, Map<String, Object> variables) {
        complete(id, null, variables, null);
    }

    @AtomicRuntimeCommand
    public void complete(String id, String workerId, Map<String, Object> variables) {
        complete(id, workerId, variables, null);
    }

    @AtomicRuntimeCommand
    public void complete(String id, String workerId, Map<String, Object> variables,
            AgentAttemptMetadata agent) {
        ExternalTaskEntity task = loadForUpdate(id);
        if (task.getStatus() == ExternalTaskEntity.Status.COMPLETED) return;
        requireOwnedActiveLock(task, workerId);

        ProcessInstance owner = requireInstance(task);
        ServiceTaskMeta meta = owner.getDefinition().getServiceTask(task.getActivityId());
        if (meta != null && meta.agentWork() != null) {
            completeAgent(task, owner, meta.agentWork(), variables, agent);
            return;
        }

        task.setStatus(ExternalTaskEntity.Status.COMPLETED);
        task.setLockExpirationTime(null);
        persistAgentMetadata(task, agent);
        repository.save(task);
        Map<String, Object> merged = new LinkedHashMap<>(variables == null ? Map.of() : variables);
        if (!owner.getDefinition().boundariesOf(task.getActivityId()).isEmpty()) {
            // A step that ran again after an error must not keep the earlier error's outcome.
            merged.put(AplParser.outcomeVariable(task.getActivityId()), AplParser.OUTCOME_OK);
            if (owner.getVariables().containsKey(AplParser.errorCodeVariable(task.getActivityId()))) {
                merged.put(AplParser.errorCodeVariable(task.getActivityId()), null);
            }
        }
        engine.resumeFromEvent(task.getProcessInstanceId(), task.getActivityId(), task.getTokenId(), merged);
        history.record("EXTERNAL_TASK_COMPLETED", requireInstance(task), task.getActivityId(),
                completedDetails(task, agent));
        recordExternalTaskFact(task, true);
    }

    @AtomicRuntimeCommand
    public void handleFailure(String id, ExternalTaskFailureDto failure) {
        ExternalTaskEntity task = loadForUpdate(id);
        requireOwnedActiveLock(task, failure.workerId());

        task.setExceptionMessage(failure.errorMessage());
        task.setExceptionStacktrace(failure.errorDetails());
        persistAgentMetadata(task, failure.agent());
        int current = task.getRetries() == null ? 3 : task.getRetries();
        if (failure.isDeferred() && current > 0 && task.getDeferrals() < maxDeferrals) {
            defer(task, failure, current);
            return;
        }
        // A deferral past the cap is an ordinary failed attempt.
        Integer retries = failure.isDeferred() ? Integer.valueOf(Math.max(0, current - 1)) : failure.retries();
        task.setRetries(retries);
        // A counted failure that will run again starts the next attempt (a fresh conversation).
        if (retries == null || retries > 0) task.setAttempt(task.getAttempt() + 1);
        if (retries != null && retries == 0) {
            task.setStatus(ExternalTaskEntity.Status.FAILED);
            task.setLockExpirationTime(null);
        } else {
            long timeout = failure.isDeferred() ? deferralDelay(task, failure).toMillis()
                    : failure.retryTimeout() == null ? 0L : failure.retryTimeout();
            boolean delayed = timeout > 0;
            task.setStatus(delayed ? ExternalTaskEntity.Status.LOCKED : ExternalTaskEntity.Status.OPEN);
            task.setLockExpirationTime(delayed ? Instant.now().plusMillis(timeout) : null);
        }
        task.setWorkerId(null);
        repository.save(task);
        history.record("EXTERNAL_TASK_FAILED", requireInstance(task), task.getActivityId(),
                failedDetails(task, failure));
        if (task.getStatus() == ExternalTaskEntity.Status.FAILED) {
            recordExternalTaskFact(task, false);
            exhausted(task, failure.errorMessage());
        }
    }

    /**
     * Every model was unavailable: keep the attempt budget, wait with a delay
     * that doubles per deferral (at least the provider's Retry-After, at most
     * {@code abada.agent.max-deferral-delay}).
     */
    private void defer(ExternalTaskEntity task, ExternalTaskFailureDto failure, int current) {
        task.setDeferrals(task.getDeferrals() + 1);
        java.time.Duration delay = deferralDelay(task, failure);
        task.setRetries(current);
        task.setStatus(ExternalTaskEntity.Status.LOCKED);
        task.setLockExpirationTime(Instant.now().plus(delay));
        task.setWorkerId(null);
        repository.save(task);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("externalTaskId", task.getId());
        details.put("deferrals", task.getDeferrals());
        details.put("delayMs", delay.toMillis());
        details.put("retries", current);
        if (failure.agent() != null) details.put("agent", agentDetails(failure.agent()));
        history.record("EXTERNAL_TASK_DEFERRED", requireInstance(task), task.getActivityId(), details);
    }

    private java.time.Duration deferralDelay(ExternalTaskEntity task, ExternalTaskFailureDto failure) {
        ProcessInstance instance = requireInstance(task);
        ServiceTaskMeta meta = instance.getDefinition().getServiceTask(task.getActivityId());
        long base = meta != null && meta.agentWork() != null && meta.agentWork().retryBackoffMs() != null
                ? Math.max(1_000L, meta.agentWork().retryBackoffMs()) : 2_000L;
        int exponent = Math.min(Math.max(0, task.getDeferrals() - 1), 20);
        long grown = base * (1L << exponent);
        long requested = failure.retryTimeout() == null ? 0L : failure.retryTimeout();
        long cap = maxDeferralDelay.toMillis();
        return java.time.Duration.ofMillis(Math.min(cap, Math.max(grown, requested)));
    }

    /**
     * The task's attempts are spent: an {@code on_error} boundary catching
     * {@code WORK_FAILED} takes the token, otherwise a {@code WORK_FAILED}
     * incident opens. A routed task is retired (CANCELLED) so it never shows
     * as retryable failed work.
     */
    private void exhausted(ExternalTaskEntity task, String message) {
        String routedTo = engine.workFailed(task.getProcessInstanceId(), task.getActivityId(), task.getTokenId(),
                message);
        if (routedTo != null) {
            task.setAgentOutcome(AplParser.OUTCOME_ERROR);
            task.setStatus(ExternalTaskEntity.Status.CANCELLED);
            repository.save(task);
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
        setRetries(id, retries, null, null);
    }

    /**
     * Operator retry of failed work: the task returns to OPEN with
     * {@code retries} attempts, optionally on another allowed model for agent
     * work, and its open {@code WORK_FAILED} incident is resolved.
     */
    @AtomicRuntimeCommand
    public void setRetries(String id, int retries, String model, String reason) {
        ExternalTaskEntity task = loadForUpdate(id);
        if (task.getStatus() == ExternalTaskEntity.Status.COMPLETED
                || task.getStatus() == ExternalTaskEntity.Status.CANCELLED) {
            throw new ProcessEngineException("External task " + id + " is " + task.getStatus()
                    + " and cannot be retried");
        }
        ProcessInstance instance = requireInstance(task);
        Map<String, Object> details = engine.reopenExternalTask(task,
                instance.getDefinition().getServiceTask(task.getActivityId()), model, reason);
        task.setRetries(retries);
        details.put("retries", retries);
        repository.save(task);
        engine.resolveWorkIncident(task.getProcessInstanceId(), task.getTokenId(), task.getActivityId());
        history.record("EXTERNAL_TASK_RETRIES_SET", instance, task.getActivityId(), details);
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

        BoundaryMeta boundary = requireInstance(task).getDefinition()
                .boundaryFor(task.getActivityId(), BoundaryMeta.Kind.ERROR, request.errorCode());
        if (boundary != null) {
            task.setAgentOutcome(AplParser.OUTCOME_ERROR);
            repository.save(task);
            Map<String, Object> routed = new LinkedHashMap<>(request.effectiveVariables());
            routed.put(AplParser.outcomeVariable(task.getActivityId()), AplParser.OUTCOME_ERROR);
            routed.put(AplParser.errorCodeVariable(task.getActivityId()), request.errorCode());
            engine.takeBoundary(task.getProcessInstanceId(), task.getActivityId(), task.getTokenId(), boundary,
                    routed, Map.of("externalTaskId", id));
            history.record("EXTERNAL_TASK_BPMN_ERROR", requireInstance(task), task.getActivityId(),
                    Map.of("externalTaskId", id, "errorCode", request.errorCode(),
                            "errorMessage", request.errorMessage() == null ? "" : request.errorMessage(),
                            "routedTo", boundary.target()));
            recordExternalTaskFact(task, false);
            return;
        }

        if (!request.effectiveVariables().isEmpty()) {
            engine.updateProcessVariables(task.getProcessInstanceId(), request.effectiveVariables());
        }
        engine.failProcess(task.getProcessInstanceId());
        history.record("EXTERNAL_TASK_BPMN_ERROR", requireInstance(task), task.getActivityId(),
                Map.of("externalTaskId", id, "errorCode", request.errorCode(),
                        "errorMessage", request.errorMessage() == null ? "" : request.errorMessage()));
        recordExternalTaskFact(task, false);
    }

    /**
     * Applies the engine-side agent output contract ({@link AgentOutputValidator}).
     * An accepted result, or a rejected one whose outcome the node routes
     * ({@code on_low_confidence} / {@code on_invalid_output}), completes the task
     * and advances the instance. A rejected result without a route counts as a
     * failed attempt: retries are decremented and, at zero, the task becomes an
     * incident.
     */
    private void completeAgent(ExternalTaskEntity task, ProcessInstance instance, AgentWorkDescriptor work,
            Map<String, Object> variables, AgentAttemptMetadata agent) {
        String activityId = task.getActivityId();
        if (instance.isSuspended() || instance.getStatus() == com.abada.engine.core.model.ProcessStatus.SUSPENDED) {
            throw new ProcessEngineException("Process instance is suspended: " + instance.getId());
        }
        if (instance.getStatus() == com.abada.engine.core.model.ProcessStatus.COMPLETED
                || instance.getStatus() == com.abada.engine.core.model.ProcessStatus.FAILED
                || instance.getStatus() == com.abada.engine.core.model.ProcessStatus.CANCELLED) {
            throw new ProcessEngineException("Process instance is already in a terminal state: "
                    + instance.getStatus());
        }
        String resultVariable = work.resultVariable() == null || work.resultVariable().isBlank()
                ? activityId + "_result" : work.resultVariable();
        AgentOutputValidator.Verdict verdict = AgentOutputValidator.validate(work, resultVariable, variables);
        boolean routed = !instance.getDefinition().boundariesOf(activityId).isEmpty();
        BoundaryMeta outcomeBoundary = verdict.ok() ? null : instance.getDefinition()
                .boundaryFor(activityId, BoundaryMeta.Kind.valueOf(verdict.outcome()), null);
        boolean hasRoute = verdict.ok() || outcomeBoundary != null;
        task.setAgentOutcome(verdict.outcome());
        persistAgentMetadata(task, agent);

        if (hasRoute) {
            Map<String, Object> merged = new LinkedHashMap<>();
            if (!AplParser.OUTCOME_INVALID_OUTPUT.equals(verdict.outcome())) {
                merged.put(resultVariable, verdict.value());
                // A step inside a loop runs again: output rejected or errors
                // reported by an earlier iteration must not leak into this one.
                for (String stale : List.of(AplParser.rawOutputVariable(activityId),
                        AplParser.errorCodeVariable(activityId))) {
                    if (instance.getVariables().containsKey(stale)) merged.put(stale, null);
                }
            } else {
                merged.put(AplParser.rawOutputVariable(activityId), truncatedJson(variables == null
                        ? null : variables.get(resultVariable)));
            }
            if (routed) merged.put(AplParser.outcomeVariable(activityId), verdict.outcome());
            task.setStatus(ExternalTaskEntity.Status.COMPLETED);
            task.setLockExpirationTime(null);
            repository.save(task);
            if (outcomeBoundary == null) {
                engine.resumeFromEvent(task.getProcessInstanceId(), activityId, task.getTokenId(), merged);
            } else {
                engine.takeBoundary(task.getProcessInstanceId(), activityId, task.getTokenId(), outcomeBoundary,
                        merged, Map.of("externalTaskId", task.getId()));
            }
            Map<String, Object> details = new LinkedHashMap<>(completedDetails(task, agent));
            details.put("agentOutcome", verdict.outcome());
            if (verdict.reason() != null) details.put("outcomeReason", verdict.reason());
            history.record("EXTERNAL_TASK_COMPLETED", requireInstance(task), activityId, details);
            recordExternalTaskFact(task, verdict.ok());
            return;
        }

        int current = task.getRetries() == null
                ? (work.maxAttempts() == null ? 3 : work.maxAttempts()) : task.getRetries();
        int remaining = Math.max(0, current - 1);
        task.setRetries(remaining);
        task.setExceptionMessage("Agent output rejected (" + verdict.outcome() + "): " + verdict.reason());
        task.setWorkerId(null);
        if (remaining == 0) {
            task.setStatus(ExternalTaskEntity.Status.FAILED);
            task.setLockExpirationTime(null);
        } else {
            long backoff = work.retryBackoffMs() == null ? 0L : work.retryBackoffMs();
            task.setStatus(backoff > 0 ? ExternalTaskEntity.Status.LOCKED : ExternalTaskEntity.Status.OPEN);
            task.setLockExpirationTime(backoff > 0 ? Instant.now().plusMillis(backoff) : null);
        }
        repository.save(task);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("externalTaskId", task.getId());
        details.put("agentOutcome", verdict.outcome());
        details.put("outcomeReason", verdict.reason());
        details.put("retries", remaining);
        if (agent != null) details.put("agent", agentDetails(agent));
        history.record("EXTERNAL_TASK_OUTPUT_REJECTED", requireInstance(task), activityId, details);
        if (task.getStatus() == ExternalTaskEntity.Status.FAILED) {
            recordExternalTaskFact(task, false);
            exhausted(task, task.getExceptionMessage());
        }
    }

    private String truncatedJson(Object value) {
        String text;
        try {
            text = value instanceof String string ? string : objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            text = String.valueOf(value);
        }
        return text.length() > 16_384 ? text.substring(0, 16_384) : text;
    }

    /** Agent request facts recorded when an {@code abada:agent} task is locked. */
    private Map<String, Object> lockDetails(ExternalTaskEntity task, String workerId, String topic,
            ServiceTaskMeta serviceTask) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("externalTaskId", task.getId());
        details.put("workerId", workerId);
        details.put("topic", topic);
        if (serviceTask != null && serviceTask.agentWork() != null) {
            var work = serviceTask.agentWork();
            Map<String, Object> requested = new LinkedHashMap<>();
            requested.put("model", valueOrEmpty(task.getModelOverride() != null ? task.getModelOverride() : work.model()));
            if (!work.fallbackModels().isEmpty()) requested.put("fallbackModels", work.fallbackModels());
            requested.put("resultVariable", valueOrEmpty(work.resultVariable()));
            if (work.tools() != null && !work.tools().isEmpty()) {
                requested.put("tools", work.tools());
            }
            if (work.confidenceThreshold() != null) {
                requested.put("confidenceThreshold", work.confidenceThreshold());
            }
            requested.put("inputs", List.copyOf(work.inputs().keySet()));
            details.put("agent", requested);
        }
        return details;
    }

    private Map<String, Object> completedDetails(ExternalTaskEntity task, AgentAttemptMetadata agent) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("externalTaskId", task.getId());
        details.put("workerId", valueOrEmpty(task.getWorkerId()));
        if (agent != null) details.put("agent", agentDetails(agent));
        return details;
    }

    private Map<String, Object> failedDetails(ExternalTaskEntity task, ExternalTaskFailureDto failure) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("externalTaskId", task.getId());
        details.put("retries", failure.retries() == null ? -1 : failure.retries());
        if (failure.agent() != null) details.put("agent", agentDetails(failure.agent()));
        return details;
    }

    /** Model/tool metadata only; never prompts, tokens, credentials or payloads. */
    private Map<String, Object> agentDetails(AgentAttemptMetadata agent) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("model", valueOrEmpty(agent.model()));
        details.put("provider", valueOrEmpty(agent.provider()));
        if (agent.attempt() != null) details.put("attempt", agent.attempt());
        if (agent.durationMs() != null) details.put("durationMs", agent.durationMs());
        if (agent.tools() != null && !agent.tools().isEmpty()) details.put("tools", agent.tools());
        details.put("resultVariable", valueOrEmpty(agent.resultVariable()));
        details.put("promptHash", valueOrEmpty(agent.promptHash()));
        details.put("errorType", valueOrEmpty(agent.errorType()));
        if (agent.confidence() != null) details.put("confidence", agent.confidence());
        if (agent.promptTokens() != null) details.put("promptTokens", agent.promptTokens());
        if (agent.completionTokens() != null) details.put("completionTokens", agent.completionTokens());
        // Set only when a fallback model ran instead of the node's declared one.
        if (agent.requestedModel() != null && !agent.requestedModel().isBlank()) {
            details.put("requestedModel", agent.requestedModel());
        }
        return details;
    }

    private void persistAgentMetadata(ExternalTaskEntity task, AgentAttemptMetadata agent) {
        if (agent == null) return;
        try {
            task.setAgentMetadataJson(objectMapper.writeValueAsString(agent));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Could not serialize agent attempt metadata", exception);
        }
        priceReportedTokens(task, agent);
    }

    /**
     * Prices the tokens an attempt reported, for workers that do not journal
     * their model calls; summed over the task's attempts. An attempt that
     * journaled MODEL_CALL steps is priced from those steps instead, so it is
     * never counted twice.
     */
    private void priceReportedTokens(ExternalTaskEntity task, AgentAttemptMetadata agent) {
        if (agent.promptTokens() == null && agent.completionTokens() == null) return;
        boolean journaled = agentStepRepository.findByExternalTaskIdAndAttemptOrderBySequenceAsc(task.getId(),
                        task.getAttempt()).stream()
                .anyMatch(step -> step.getKind() == com.abada.engine.persistence.entity.AgentStepEntity.Kind.MODEL_CALL);
        if (journaled) return;
        task.addAttemptTokens(agent.promptTokens(), agent.completionTokens());
        com.abada.engine.llm.ModelPriceService.Cost cost = prices.cost(agent.model(), agent.promptTokens(),
                agent.completionTokens(), Instant.now());
        if (cost.unpriced()) {
            task.setAttemptCostUnpriced(true);
            return;
        }
        if (cost.usd() == null) return;
        task.setAttemptCostUsd(task.getAttemptCostUsd() == null ? cost.usd() : task.getAttemptCostUsd().add(cost.usd()));
        ProcessInstance instance = engine.getProcessInstanceById(task.getProcessInstanceId());
        metrics.recordAgentCost(instance == null ? null : instance.getDefinition().getId(), agent.model(), cost.usd());
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
        ExternalTaskEntity task = repository.findByIdForUpdate(id)
                .orElseThrow(() -> new ProcessEngineException("External task not found: " + id));
        // With open-in-view, an earlier read in the same request (the worker
        // access check) can leave a managed copy that a concurrent heartbeat
        // has since superseded. The locking query returns that stale copy, so
        // reload it from the locked row before validating or saving.
        entityManager.refresh(task, LockModeType.PESSIMISTIC_WRITE);
        return task;
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
