package com.abada.engine.core.agent;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.ServiceTaskMeta;
import com.abada.engine.core.model.ToolBinding;
import com.abada.engine.core.model.ToolPolicy;
import com.abada.engine.dto.AgentStepDto;
import com.abada.engine.dto.AgentStepRequest;
import com.abada.engine.persistence.entity.AgentStepEntity;
import com.abada.engine.persistence.entity.AgentStepEntity.Kind;
import com.abada.engine.persistence.entity.AgentStepEntity.State;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.repository.AgentStepRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.security.AesEncryption;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The agent step journal (E9). The worker holding an agent task's lease
 * records every model call and tool call before and after it runs; the engine
 * decides whether the step may happen at all.
 *
 * <p>Recording a step locks only the external-task row: it never advances the
 * process and never holds the instance lock. Steps are append-only and only
 * their state moves forward. Payloads are stored AES-GCM encrypted; digests
 * are computed here from the canonical JSON, never trusted from the worker.
 */
@Service
public class AgentStepService {
    /** Steps one external task may journal across all its attempts. */
    public static final int MAX_STEPS_PER_TASK = 256;
    /** Largest request or result payload of one step, as serialized JSON. */
    public static final int MAX_PAYLOAD_BYTES = 1024 * 1024;

    private static final Set<ExternalTaskEntity.Status> RETIRED = Set.of(ExternalTaskEntity.Status.COMPLETED,
            ExternalTaskEntity.Status.CANCELLED, ExternalTaskEntity.Status.FAILED,
            ExternalTaskEntity.Status.BPMN_ERROR);
    private static final ObjectMapper CANONICAL = JsonMapper.builder()
            .enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS).build();

    /** What a worker needs to resume an agent task, or that the task must not be handed out. */
    public record LockView(List<AgentStepDto> steps, List<AgentStepDto> priorWrites, boolean blocked) {
        static final LockView NONE = new LockView(List.of(), List.of(), false);
        static final LockView BLOCKED = new LockView(List.of(), List.of(), true);
    }

    private final ExternalTaskRepository externalTasks;
    private final AgentStepRepository steps;
    private final AbadaEngine engine;
    private final AesEncryption encryption;
    private final ObjectMapper json;
    private final ActivityHistoryService history;
    private final EntityManager entityManager;

    public AgentStepService(ExternalTaskRepository externalTasks, AgentStepRepository steps, AbadaEngine engine,
            AesEncryption encryption, ObjectMapper json, ActivityHistoryService history,
            EntityManager entityManager) {
        this.externalTasks = externalTasks;
        this.steps = steps;
        this.engine = engine;
        this.encryption = encryption;
        this.json = json;
        this.history = history;
        this.entityManager = entityManager;
    }

    /**
     * Records one step for the lease holder. A step is born {@code STARTED}
     * (required for writes, so the write is journaled before it can happen) or,
     * for model calls and read tools, directly finished; a {@code STARTED} step
     * then moves to {@code COMPLETED} or {@code FAILED}. Re-sending an identical
     * request is idempotent.
     */
    @Transactional
    public AgentStepDto record(String externalTaskId, AgentStepRequest request) {
        if (request == null) throw invalid("A step body is required");
        ExternalTaskEntity task = externalTasks.findByIdForUpdate(externalTaskId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "External task not found: " + externalTaskId));
        entityManager.refresh(task, LockModeType.PESSIMISTIC_WRITE);
        if (RETIRED.contains(task.getStatus())) {
            throw new ApiException(HttpStatus.GONE, ApiErrorCode.WORK_RETIRED,
                    "External task " + externalTaskId + " is " + task.getStatus() + "; its lease no longer acts");
        }
        if (request.workerId() == null || request.workerId().isBlank()) throw invalid("workerId is required");
        if (task.getStatus() != ExternalTaskEntity.Status.LOCKED || task.getLockExpirationTime() == null
                || task.getLockExpirationTime().isBefore(Instant.now())) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.WORKER_LOCK_EXPIRED,
                    "External task " + externalTaskId + " is not locked by a live lease");
        }
        if (!request.workerId().equals(task.getWorkerId())) {
            throw new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.WORKER_LOCK_NOT_OWNED,
                    "Worker does not own external task lock: " + externalTaskId);
        }
        if (request.attempt() == null || request.attempt() != task.getAttempt()) {
            throw rejected("STALE_ATTEMPT", "The task is on attempt " + task.getAttempt());
        }
        if (request.sequence() == null || request.sequence() < 1) throw invalid("sequence must be 1 or more");
        Kind kind = parse(Kind.class, request.kind(), "kind");
        State state = parse(State.class, request.state(), "state");
        if (state == State.OUTCOME_UNKNOWN) throw invalid("OUTCOME_UNKNOWN is set by the engine, not by a worker");
        if (kind == Kind.MODEL_CALL && request.toolRef() != null) throw invalid("a model call names no toolRef");
        if (kind == Kind.TOOL_CALL && (request.toolRef() == null || request.toolRef().isBlank())) {
            throw invalid("a tool call needs toolRef");
        }
        if (!state.terminal() && request.result() != null) throw invalid("a STARTED step carries no result");

        ProcessInstance instance = engine.getProcessInstanceById(task.getProcessInstanceId());
        ServiceTaskMeta meta = instance == null ? null : instance.getDefinition().getServiceTask(task.getActivityId());
        if (meta == null || meta.agentWork() == null) throw invalid("Steps are journaled for agent work only");

        String requestJson = canonical(request.request(), "request");
        String requestDigest = sha256(requestJson);
        String resultJson = state.terminal() ? canonical(request.result(), "result") : null;
        String resultDigest = resultJson == null ? null : sha256(resultJson);

        AgentStepEntity existing = steps.findByExternalTaskIdAndAttemptAndSequence(task.getId(), task.getAttempt(),
                request.sequence()).orElse(null);
        if (existing != null) {
            return continueStep(existing, instance, kind, state, request, requestDigest, resultJson, resultDigest);
        }

        AgentStepEntity last = steps.findFirstByExternalTaskIdAndAttemptOrderBySequenceDesc(task.getId(),
                task.getAttempt()).orElse(null);
        int expected = last == null ? 1 : last.getSequence() + 1;
        if (request.sequence() != expected) {
            throw rejected("SEQUENCE", "The next step of attempt " + task.getAttempt() + " is " + expected);
        }
        if (last != null && last.getState() == State.STARTED) {
            throw rejected("OPEN_STEP", "Step " + last.getSequence() + " is still STARTED; finish it first");
        }
        if (steps.countByExternalTaskId(task.getId()) >= MAX_STEPS_PER_TASK) {
            throw rejected("STEP_LIMIT", "An agent task may journal at most " + MAX_STEPS_PER_TASK + " steps");
        }

        AgentStepEntity step = new AgentStepEntity();
        step.setExternalTaskId(task.getId());
        step.setProcessInstanceId(task.getProcessInstanceId());
        step.setTokenId(task.getTokenId());
        step.setActivityId(task.getActivityId());
        step.setAttempt(task.getAttempt());
        step.setSequence(request.sequence());
        step.setKind(kind);
        step.setRequestDigest(requestDigest);
        step.setRequestEnc(encrypt(requestJson));
        step.setModel(request.model());
        step.setPromptVersion(request.promptVersion());
        step.setWorkerId(request.workerId());
        step.setStartedAt(Instant.now());

        boolean reused = false;
        if (kind == Kind.TOOL_CALL) {
            String ref = request.toolRef().strip();
            ToolBinding binding = engine.toolBindings(instance, task.getActivityId()).stream()
                    .filter(candidate -> candidate.ref().equals(ref)).findFirst()
                    .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                            "Tool '" + ref + "' is not bound to this agent task", Map.of("reason", "TOOL_NOT_BOUND")));
            ToolPolicy policy = binding.policy();
            if (policy == ToolPolicy.APPROVAL_REQUIRED) {
                throw rejected("APPROVAL_REQUIRED", "Tool '" + ref + "' needs a person's approval before it runs");
            }
            step.setToolRef(ref);
            step.setPolicy(policy.wireName());
            if (policy != ToolPolicy.READ) {
                if (state != State.STARTED) {
                    throw rejected("WRITE_AHEAD_REQUIRED",
                            "A write is journaled as STARTED before it runs, then finished");
                }
                if ("key".equals(binding.idempotency())) {
                    step.setIdempotencyKey(sha256(task.getId() + ":" + task.getAttempt() + ":" + request.sequence()));
                }
                AgentStepEntity done = priorIdenticalWrite(task, ref, requestDigest);
                if (done != null) {
                    // An earlier attempt already performed this exact write: record its result, never resend it.
                    step.setState(State.COMPLETED);
                    step.setResultEnc(done.getResultEnc());
                    step.setResultDigest(done.getResultDigest());
                    step.setFinishedAt(Instant.now());
                    reused = true;
                }
            }
        }
        if (!reused) {
            step.setState(state);
            if (state.terminal()) finish(step, state, request, resultJson, resultDigest);
        }
        steps.save(step);
        recordToolHistory(instance, step, reused);
        return view(step, reused, reused);
    }

    private AgentStepDto continueStep(AgentStepEntity existing, ProcessInstance instance, Kind kind, State state,
            AgentStepRequest request, String requestDigest, String resultJson, String resultDigest) {
        if (existing.getKind() != kind || !Objects.equals(existing.getToolRef(), trim(request.toolRef()))
                || !existing.getRequestDigest().equals(requestDigest)) {
            throw rejected("DIVERGENT_STEP", "Step " + existing.getSequence() + " was journaled with another request");
        }
        if (existing.getState() == state) {
            if (state.terminal() && !Objects.equals(existing.getResultDigest(), resultDigest)) {
                throw rejected("DIVERGENT_STEP", "Step " + existing.getSequence() + " finished with another result");
            }
            return view(existing, false, false);
        }
        if (existing.getState() != State.STARTED || !state.terminal()) {
            throw rejected("STEP_FINISHED", "Step " + existing.getSequence() + " is already " + existing.getState());
        }
        finish(existing, state, request, resultJson, resultDigest);
        steps.save(existing);
        recordToolHistory(instance, existing, false);
        return view(existing, false, false);
    }

    private void finish(AgentStepEntity step, State state, AgentStepRequest request, String resultJson,
            String resultDigest) {
        step.setState(state);
        step.setResultEnc(encrypt(resultJson));
        step.setResultDigest(resultDigest);
        step.setErrorType(state == State.FAILED ? truncate(request.errorType(), 255) : null);
        step.setPromptTokens(request.promptTokens());
        step.setCompletionTokens(request.completionTokens());
        if (request.model() != null) step.setModel(request.model());
        step.setFinishedAt(Instant.now());
    }

    private AgentStepEntity priorIdenticalWrite(ExternalTaskEntity task, String ref, String requestDigest) {
        return steps.findByExternalTaskIdOrderByAttemptAscSequenceAsc(task.getId()).stream()
                .filter(step -> step.getAttempt() < task.getAttempt())
                .filter(step -> step.getKind() == Kind.TOOL_CALL && ref.equals(step.getToolRef()))
                .filter(step -> step.getState() == State.COMPLETED && requestDigest.equals(step.getRequestDigest()))
                .findFirst().orElse(null);
    }

    /**
     * Called by fetch-and-lock for an agent task it just locked: the steps of
     * the current attempt to resume from, and the writes earlier attempts
     * completed. A write without an idempotency key left {@code STARTED} by a
     * crash is never handed out again: it becomes {@code OUTCOME_UNKNOWN}, the
     * task stops, and a {@code TOOL_OUTCOME_UNKNOWN} incident asks a person.
     */
    public LockView prepareLock(ExternalTaskEntity task) {
        List<AgentStepEntity> all = steps.findByExternalTaskIdOrderByAttemptAscSequenceAsc(task.getId());
        if (all.isEmpty()) return LockView.NONE;
        List<AgentStepEntity> current = all.stream().filter(step -> step.getAttempt() == task.getAttempt()).toList();
        AgentStepEntity last = current.isEmpty() ? null : current.getLast();
        if (last != null && last.getState() == State.STARTED && last.getKind() == Kind.TOOL_CALL
                && !ToolPolicy.READ.wireName().equals(last.getPolicy()) && last.getIdempotencyKey() == null) {
            last.setState(State.OUTCOME_UNKNOWN);
            last.setFinishedAt(Instant.now());
            steps.save(last);
            task.setStatus(ExternalTaskEntity.Status.FAILED);
            task.setWorkerId(null);
            task.setLockExpirationTime(null);
            externalTasks.save(task);
            engine.toolOutcomeUnknown(task.getProcessInstanceId(), task.getTokenId(), task.getActivityId(),
                    last.getToolRef(), last.getSequence());
            return LockView.BLOCKED;
        }
        List<AgentStepDto> resume = current.stream().map(step -> view(step, true, false)).toList();
        List<AgentStepDto> priorWrites = all.stream()
                .filter(step -> step.getAttempt() < task.getAttempt() && step.getKind() == Kind.TOOL_CALL)
                .filter(step -> step.getState() == State.COMPLETED
                        && !ToolPolicy.READ.wireName().equals(step.getPolicy()))
                .map(step -> view(step, true, false)).toList();
        return new LockView(resume, priorWrites, false);
    }

    private void recordToolHistory(ProcessInstance instance, AgentStepEntity step, boolean reused) {
        if (step.getKind() != Kind.TOOL_CALL) return;
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("externalTaskId", step.getExternalTaskId());
        details.put("attempt", step.getAttempt());
        details.put("sequence", step.getSequence());
        details.put("toolRef", step.getToolRef());
        details.put("policy", step.getPolicy());
        details.put("state", step.getState().name());
        details.put("requestDigest", step.getRequestDigest());
        if (step.getResultDigest() != null) details.put("resultDigest", step.getResultDigest());
        if (reused) details.put("reused", true);
        history.record("AGENT_TOOL_STEP", instance, step.getActivityId(), details);
    }

    private AgentStepDto view(AgentStepEntity step, boolean withPayloads, boolean reused) {
        return new AgentStepDto(step.getAttempt(), step.getSequence(), step.getKind().name(), step.getState().name(),
                step.getToolRef(), step.getPolicy(), step.getIdempotencyKey(), step.getRequestDigest(),
                step.getResultDigest(), withPayloads ? decrypt(step.getRequestEnc()) : null,
                withPayloads || reused ? decrypt(step.getResultEnc()) : null, step.getErrorType(), step.getModel(),
                step.getPromptTokens(), step.getCompletionTokens(), reused ? Boolean.TRUE : null);
    }

    /** SHA-256 of the canonical (key-sorted) JSON of a payload; the journal's digest. */
    public static String digest(JsonNode payload) {
        return sha256(canonicalJson(payload));
    }

    private static String canonicalJson(JsonNode payload) {
        try {
            Object plain = CANONICAL.treeToValue(payload == null ? NullNode.getInstance() : payload, Object.class);
            return CANONICAL.writeValueAsString(plain);
        } catch (JsonProcessingException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, "Unreadable step payload");
        }
    }

    private static String canonical(JsonNode payload, String field) {
        String value = canonicalJson(payload);
        if (value.getBytes(StandardCharsets.UTF_8).length > MAX_PAYLOAD_BYTES) {
            throw invalid(field + " exceeds " + MAX_PAYLOAD_BYTES / 1024 + " KiB");
        }
        return value;
    }

    private String encrypt(String plaintext) {
        return plaintext == null ? null : encryption.encrypt(plaintext);
    }

    private JsonNode decrypt(String ciphertext) {
        if (ciphertext == null) return null;
        try {
            return json.readTree(encryption.decrypt(ciphertext));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("A journaled step payload cannot be read", exception);
        }
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static <E extends Enum<E>> E parse(Class<E> type, String value, String field) {
        if (value == null) throw invalid(field + " is required");
        try {
            return Enum.valueOf(type, value.strip().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException exception) {
            throw invalid("Unknown " + field + " '" + value + "'");
        }
    }

    private static String trim(String value) {
        return value == null ? null : value.strip();
    }

    private static String truncate(String value, int max) {
        return value == null || value.length() <= max ? value : value.substring(0, max);
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, message);
    }

    private static ApiException rejected(String reason, String message) {
        return new ApiException(HttpStatus.CONFLICT, ApiErrorCode.AGENT_STEP_REJECTED, message,
                Map.of("reason", reason));
    }
}
