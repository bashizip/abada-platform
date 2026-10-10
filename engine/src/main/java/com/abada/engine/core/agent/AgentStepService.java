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
    private final com.abada.engine.llm.ModelPriceService prices;
    private final com.abada.engine.persistence.repository.ProjectRepository projects;
    private final com.abada.engine.observability.EngineMetrics metrics;

    public AgentStepService(ExternalTaskRepository externalTasks, AgentStepRepository steps, AbadaEngine engine,
            AesEncryption encryption, ObjectMapper json, ActivityHistoryService history,
            EntityManager entityManager, com.abada.engine.llm.ModelPriceService prices,
            com.abada.engine.persistence.repository.ProjectRepository projects,
            com.abada.engine.observability.EngineMetrics metrics) {
        this.prices = prices;
        this.projects = projects;
        this.metrics = metrics;
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
        if (task.getStatus() == ExternalTaskEntity.Status.AWAITING_APPROVAL
                || task.getStatus() == ExternalTaskEntity.Status.AWAITING_CHILD) {
            return replayParked(task, request);
        }
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
        if (state == State.APPROVED || state == State.REJECTED) {
            throw invalid(state + " is set by a person's decision, not by a worker");
        }
        if (state == State.PROPOSED && kind == Kind.MODEL_CALL) throw invalid("only a tool call or delegation is proposed");
        if (state == State.PROPOSED && request.result() != null) throw invalid("a PROPOSED step carries no result");
        if (kind == Kind.MODEL_CALL && request.toolRef() != null) throw invalid("a model call names no toolRef");
        if (kind != Kind.MODEL_CALL && (request.toolRef() == null || request.toolRef().isBlank())) {
            throw invalid("a tool call or delegation needs toolRef");
        }
        if (kind == Kind.DELEGATION && state.terminal()) {
            throw invalid("a delegation is finished by the engine when its child process ends");
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
            return continueStep(task, existing, instance, kind, state, request, requestDigest, resultJson,
                    resultDigest);
        }

        AgentStepEntity last = steps.findFirstByExternalTaskIdAndAttemptOrderBySequenceDesc(task.getId(),
                task.getAttempt()).orElse(null);
        int expected = last == null ? 1 : last.getSequence() + 1;
        if (request.sequence() != expected) {
            throw rejected("SEQUENCE", "The next step of attempt " + task.getAttempt() + " is " + expected);
        }
        if (last != null && !last.getState().terminal()) {
            throw rejected("OPEN_STEP", "Step " + last.getSequence() + " is still " + last.getState()
                    + "; finish it first");
        }
        if (steps.countByExternalTaskId(task.getId()) >= MAX_STEPS_PER_TASK) {
            throw rejected("STEP_LIMIT", "An agent task may journal at most " + MAX_STEPS_PER_TASK + " steps");
        }
        if (kind == Kind.MODEL_CALL) requireWithinLimits(task, meta.agentWork().limits(), request.model());

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
        // The auditor's copy, shaped by the evidence policy; the request column is the worker's working copy.
        EvidencePolicy evidence = policyFor(instance, task.getActivityId());
        step.setPayloadMode(evidence.payloads().wireName());
        step.setEvidenceRequestEnc(evidenceCopy(evidence.payloads(), instance, request.request()));
        step.setPurgeAfter(Instant.now().plus(java.time.Duration.ofDays(evidence.retentionDays())));
        step.setModel(request.model());
        step.setPromptVersion(request.promptVersion());
        step.setWorkerId(request.workerId());
        step.setStartedAt(Instant.now());

        boolean reused = false;
        ToolBinding proposed = null;
        com.abada.engine.core.model.DelegationMeta delegate = null;
        if (kind == Kind.DELEGATION) {
            String ref = request.toolRef().strip();
            delegate = instance.getDefinition().getDelegations(task.getActivityId()).stream()
                    .filter(candidate -> candidate.toolRef().equals(ref)).findFirst()
                    .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                            "'" + ref + "' is not a delegation this agent task declares",
                            Map.of("reason", "TOOL_NOT_BOUND")));
            if (delegate.approvalRequired() && state != State.PROPOSED) {
                throw rejected("APPROVAL_REQUIRED", "Delegating to '" + delegate.process() + "' needs a person's"
                        + " approval first; journal the call as PROPOSED");
            }
            if (!delegate.approvalRequired() && state == State.PROPOSED) {
                throw invalid("Delegating to '" + delegate.process() + "' needs no approval; journal it STARTED");
            }
            // Refused before anything is recorded: inputs the child does not accept, or too deep a nesting.
            engine.checkDelegation(instance, task.getActivityId(), delegate, arguments(request));
            step.setToolRef(ref);
            step.setPolicy(delegate.approvalRequired() ? ToolPolicy.APPROVAL_REQUIRED.wireName() : "delegate");
        }
        if (kind == Kind.TOOL_CALL) {
            String ref = request.toolRef().strip();
            ToolBinding binding = engine.toolBindings(instance, task.getActivityId()).stream()
                    .filter(candidate -> candidate.ref().equals(ref)).findFirst()
                    .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                            "Tool '" + ref + "' is not bound to this agent task", Map.of("reason", "TOOL_NOT_BOUND")));
            ToolPolicy policy = binding.policy();
            if (policy == ToolPolicy.APPROVAL_REQUIRED && state != State.PROPOSED) {
                throw rejected("APPROVAL_REQUIRED", "Tool '" + ref + "' needs a person's approval before it runs;"
                        + " journal the call as PROPOSED");
            }
            if (policy != ToolPolicy.APPROVAL_REQUIRED && state == State.PROPOSED) {
                throw invalid("Tool '" + ref + "' is " + policy.wireName() + "; only approval_required calls are"
                        + " proposed");
            }
            step.setToolRef(ref);
            step.setPolicy(policy.wireName());
            if (policy == ToolPolicy.APPROVAL_REQUIRED) {
                AgentStepEntity done = priorIdenticalWrite(task, ref, request.request());
                if (done != null) {
                    // An earlier attempt already ran this exact approved call: its result, no second approval.
                    step.setState(State.COMPLETED);
                    step.setResultEnc(done.getResultEnc());
                    step.setEvidenceResultEnc(done.getEvidenceResultEnc());
                    step.setResultDigest(done.getResultDigest());
                    step.setFinishedAt(Instant.now());
                    reused = true;
                } else {
                    proposed = binding;
                }
            } else if (policy != ToolPolicy.READ) {
                if (state != State.STARTED) {
                    throw rejected("WRITE_AHEAD_REQUIRED",
                            "A write is journaled as STARTED before it runs, then finished");
                }
                if ("key".equals(binding.idempotency())) {
                    step.setIdempotencyKey(sha256(task.getId() + ":" + task.getAttempt() + ":" + request.sequence()));
                }
                AgentStepEntity done = priorIdenticalWrite(task, ref, request.request());
                if (done != null) {
                    // An earlier attempt already performed this exact write: record its result, never resend it.
                    step.setState(State.COMPLETED);
                    step.setResultEnc(done.getResultEnc());
                    step.setEvidenceResultEnc(done.getEvidenceResultEnc());
                    step.setResultDigest(done.getResultDigest());
                    step.setFinishedAt(Instant.now());
                    reused = true;
                }
            }
        }
        if (!reused) {
            step.setState(state);
            if (state.terminal()) finish(step, state, request, resultJson, resultDigest, instance);
        }
        steps.save(step);
        recordToolHistory(instance, step, reused);
        if (proposed != null) park(task, step, proposed.approvers(), proposed.approvalSlaHours());
        if (delegate != null) {
            if (state == State.PROPOSED) park(task, step, delegate.approvers(), null);
            else startDelegation(task, step, delegate, instance, request);
        }
        return view(step, reused, reused);
    }

    /**
     * Starts the child of a {@code STARTED} delegation and parks the agent's
     * work until it ends: the lease is released and the task is not acquirable.
     * The child's end finishes the step and reopens the work (E20b).
     */
    private void startDelegation(ExternalTaskEntity task, AgentStepEntity step,
            com.abada.engine.core.model.DelegationMeta delegate, ProcessInstance instance, AgentStepRequest request) {
        task.setStatus(ExternalTaskEntity.Status.AWAITING_CHILD);
        task.setWorkerId(null);
        task.setLockExpirationTime(null);
        externalTasks.save(task);
        Map<String, Object> agent = new LinkedHashMap<>();
        agent.put("nodeId", task.getActivityId());
        agent.put("processDefinitionId", instance.getDefinition().getId());
        agent.put("deploymentId", instance.getProcessDefinitionDeploymentId());
        if (request.promptVersion() != null) agent.put("promptVersion", request.promptVersion());
        ServiceTaskMeta meta = instance.getDefinition().getServiceTask(task.getActivityId());
        if (meta != null && meta.agentWork() != null && meta.agentWork().model() != null) {
            agent.put("model", meta.agentWork().model());
        }
        agent.put("externalTaskId", task.getId());
        agent.put("step", step.getSequence());
        String childId = engine.startDelegatedChild(task.getProcessInstanceId(), task.getTokenId(),
                task.getActivityId(), delegate, arguments(request), canonicalJson(json.valueToTree(agent)));
        step.setChildInstanceId(childId);
        steps.save(step);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("externalTaskId", task.getId());
        details.put("sequence", step.getSequence());
        details.put("process", delegate.process());
        details.put("childInstanceId", childId);
        details.put("requestDigest", step.getRequestDigest());
        history.record("DELEGATION_STARTED", instance, task.getActivityId(), details);
    }

    /** The arguments of a delegation's {@code {callId, arguments}} request, as the child's inputs. */
    @SuppressWarnings("unchecked")
    private Map<String, Object> arguments(AgentStepRequest request) {
        JsonNode arguments = request.request() == null ? null : request.request().get("arguments");
        if (arguments == null || arguments.isNull()) return Map.of();
        if (!arguments.isObject()) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.AGENT_STEP_REJECTED,
                    "A delegation's arguments must be an object", Map.of("reason", "DELEGATION_INPUT_INVALID"));
        }
        return json.convertValue(arguments, Map.class);
    }

    /**
     * Finishes a delegation when its child ends, under the caller's lock of the
     * agent's external task: {@code COMPLETED} with the declared outputs, or
     * {@code FAILED} with the child's status. The agent reads it on resume.
     */
    public void finishDelegation(AgentStepEntity step, ProcessInstance instance, boolean completed,
            Map<String, Object> result) {
        String resultJson = canonicalJson(json.valueToTree(result));
        step.setState(completed ? State.COMPLETED : State.FAILED);
        step.setResultEnc(encrypt(resultJson));
        step.setEvidenceResultEnc(evidenceCopy(EvidencePolicy.Mode.fromWire(step.getPayloadMode()), instance,
                json.valueToTree(result)));
        step.setResultDigest(sha256(resultJson));
        step.setErrorType(completed ? null : "CHILD_" + result.get("status"));
        step.setFinishedAt(Instant.now());
        steps.save(step);
        recordToolHistory(instance, step, false);
    }

    /**
     * Parks the agent's work on a proposed call: the lease is released, the
     * task is not acquirable, and a person in the binding's approver groups
     * gets the approval task. All in the step command.
     */
    private void park(ExternalTaskEntity task, AgentStepEntity step, List<String> approvers, Double slaHours) {
        task.setStatus(ExternalTaskEntity.Status.AWAITING_APPROVAL);
        task.setWorkerId(null);
        task.setLockExpirationTime(null);
        externalTasks.save(task);
        engine.openToolApproval(task.getProcessInstanceId(), task.getTokenId(), task.getActivityId(), step.getId(),
                step.getToolRef(), step.getSequence(), step.getRequestDigest(), approvers, slaHours);
    }

    /**
     * A worker re-sending the proposal it made (its response was lost) gets the
     * step back; anything else on parked work is refused, as it holds no lease.
     */
    private AgentStepDto replayParked(ExternalTaskEntity task, AgentStepRequest request) {
        AgentStepEntity step = request.sequence() == null || request.attempt() == null
                || request.attempt() != task.getAttempt() ? null
                : steps.findByExternalTaskIdAndAttemptAndSequence(task.getId(), task.getAttempt(), request.sequence())
                        .orElse(null);
        // The proposal that parked it for approval, or the delegation whose child it waits for.
        State parked = task.getStatus() == ExternalTaskEntity.Status.AWAITING_CHILD ? State.STARTED : State.PROPOSED;
        if (step != null && step.getState() == parked && parked.name().equalsIgnoreCase(trim(request.state()))
                && (parked == State.PROPOSED || step.getKind() == Kind.DELEGATION)
                && request.workerId().equals(step.getWorkerId())
                && Objects.equals(step.getToolRef(), trim(request.toolRef()))
                && step.getRequestDigest().equals(sha256(canonical(request.request(), "request")))) {
            return view(step, false, false);
        }
        throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.WORKER_LOCK_EXPIRED, "External task "
                + task.getId() + (task.getStatus() == ExternalTaskEntity.Status.AWAITING_CHILD
                        ? " is waiting for the process it delegated to" : " is waiting for a person to approve a tool call")
                + "; it holds no lease");
    }

    /**
     * A person's decision on a {@code PROPOSED} step, under the caller's lock
     * of its external task. Approve: the call may run next, with exactly these
     * arguments. Reject: the step finishes with the rejection as its result,
     * which the agent reads when it resumes.
     */
    public void decide(AgentStepEntity step, ProcessInstance instance, boolean approved, String comment,
            String actor) {
        if (step.getState() != State.PROPOSED) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "Step " + step.getSequence() + " is " + step.getState() + ", not waiting for approval");
        }
        Instant now = Instant.now();
        step.setResolvedBy(actor);
        step.setDecidedAt(now);
        if (approved) {
            step.setState(State.APPROVED);
        } else {
            com.fasterxml.jackson.databind.node.ObjectNode result = json.createObjectNode();
            result.put("rejected", true);
            result.put("comment", comment);
            String resultJson = canonicalJson(result);
            step.setState(State.REJECTED);
            step.setResultEnc(encrypt(resultJson));
            step.setEvidenceResultEnc(evidenceCopy(EvidencePolicy.Mode.fromWire(step.getPayloadMode()), instance,
                    result));
            step.setResultDigest(sha256(resultJson));
            step.setFinishedAt(now);
        }
        steps.save(step);
        recordToolHistory(instance, step, false);
    }

    /** The arguments of a proposed call as the evidence policy keeps them; null under {@code none} or purged. */
    public JsonNode proposedArguments(AgentStepEntity step) {
        JsonNode request = decrypt(step.getEvidenceRequestEnc());
        return request == null ? null : request.path("arguments").isMissingNode() ? request : request.get("arguments");
    }

    private AgentStepDto continueStep(ExternalTaskEntity task, AgentStepEntity existing, ProcessInstance instance,
            Kind kind, State state, AgentStepRequest request, String requestDigest, String resultJson,
            String resultDigest) {
        if (existing.getKind() != kind || !Objects.equals(existing.getToolRef(), trim(request.toolRef()))
                || !existing.getRequestDigest().equals(requestDigest)) {
            throw rejected("DIVERGENT_STEP", "Step " + existing.getSequence() + " was journaled with another request");
        }
        if (existing.getState() == State.APPROVED) {
            if (state != State.STARTED) {
                throw rejected("WRITE_AHEAD_REQUIRED", "An approved call is journaled as STARTED before it runs");
            }
            if (existing.getKind() == Kind.DELEGATION) {
                com.abada.engine.core.model.DelegationMeta delegate = instance.getDefinition()
                        .getDelegations(existing.getActivityId()).stream()
                        .filter(candidate -> candidate.toolRef().equals(existing.getToolRef())).findFirst()
                        .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                                "'" + existing.getToolRef() + "' is not a delegation this agent task declares",
                                Map.of("reason", "TOOL_NOT_BOUND")));
                existing.setState(State.STARTED);
                steps.save(existing);
                recordToolHistory(instance, existing, false);
                startDelegation(task, existing, delegate, instance, request);
                return view(existing, false, false);
            }
            // The approved arguments, unchanged (the digest check above): the call may run now.
            ToolBinding binding = engine.toolBindings(instance, existing.getActivityId()).stream()
                    .filter(candidate -> candidate.ref().equals(existing.getToolRef())).findFirst()
                    .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                            "Tool '" + existing.getToolRef() + "' is not bound to this agent task",
                            Map.of("reason", "TOOL_NOT_BOUND")));
            existing.setState(State.STARTED);
            if ("key".equals(binding.idempotency())) {
                existing.setIdempotencyKey(sha256(existing.getExternalTaskId() + ":" + existing.getAttempt() + ":"
                        + existing.getSequence()));
            }
            steps.save(existing);
            recordToolHistory(instance, existing, false);
            return view(existing, false, false);
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
        finish(existing, state, request, resultJson, resultDigest, instance);
        steps.save(existing);
        recordToolHistory(instance, existing, false);
        return view(existing, false, false);
    }

    private void finish(AgentStepEntity step, State state, AgentStepRequest request, String resultJson,
            String resultDigest, ProcessInstance instance) {
        step.setState(state);
        step.setResultEnc(encrypt(resultJson));
        step.setEvidenceResultEnc(evidenceCopy(EvidencePolicy.Mode.fromWire(step.getPayloadMode()), instance,
                request.result()));
        step.setResultDigest(resultDigest);
        step.setErrorType(state == State.FAILED ? truncate(request.errorType(), 255) : null);
        step.setPromptTokens(request.promptTokens());
        step.setCompletionTokens(request.completionTokens());
        if (request.model() != null) step.setModel(request.model());
        step.setFinishedAt(Instant.now());
        if (step.getKind() == Kind.MODEL_CALL) {
            // Priced by the engine from the tokens and the price in effect, never from a worker's figure.
            com.abada.engine.llm.ModelPriceService.Cost cost = prices.cost(step.getModel(), step.getPromptTokens(),
                    step.getCompletionTokens(), step.getStartedAt());
            step.setCostUsd(cost.usd());
            step.setCostUnpriced(cost.unpriced());
            metrics.recordAgentCost(instance.getDefinition().getId(), step.getModel(), cost.usd());
        }
    }

    /** The project's evidence policy, tightened by the agent node's {@code evidence} override. */
    private EvidencePolicy policyFor(ProcessInstance instance, String activityId) {
        EvidencePolicy project = projects.findById(instance.getProjectId())
                .map(row -> new EvidencePolicy(EvidencePolicy.Mode.fromWire(row.getEvidencePayloads()),
                        row.getEvidenceRetentionDays()))
                .orElse(EvidencePolicy.DEFAULT);
        var override = instance.getDefinition().getEvidenceOverride(activityId);
        return override == null ? project
                : project.tightenedBy(EvidencePolicy.Mode.fromWire(override.payloads()), override.retentionDays());
    }

    /** The encrypted evidence copy of a payload under a mode: nothing, redacted, or as sent. */
    private String evidenceCopy(EvidencePolicy.Mode mode, ProcessInstance instance, JsonNode payload) {
        if (payload == null || mode == null || mode == EvidencePolicy.Mode.NONE) return null;
        JsonNode kept = mode == EvidencePolicy.Mode.FULL ? payload : redactorFor(instance).redact(payload);
        return encryption.encrypt(canonicalJson(kept));
    }

    private EvidenceRedactor redactorFor(ProcessInstance instance) {
        java.util.Map<String, Object> sensitive = new java.util.LinkedHashMap<>();
        for (String name : instance.getDefinition().getSensitiveVariables()) {
            sensitive.put(name, instance.getVariables().get(name));
        }
        return new EvidenceRedactor(sensitive);
    }

    /**
     * The node's loop limits, checked before a model call may happen: turns of
     * this attempt, and tokens and engine-computed cost of the whole task (its
     * journaled steps plus tokens attempts reported without journaling).
     */
    private void requireWithinLimits(ExternalTaskEntity task, com.abada.engine.core.model.AgentLimits limits,
            String model) {
        if (limits == null) return;
        List<AgentStepEntity> all = steps.findByExternalTaskIdOrderByAttemptAscSequenceAsc(task.getId());
        if (limits.maxTurns() != null && all.stream().filter(step -> step.getAttempt() == task.getAttempt()
                && step.getKind() == Kind.MODEL_CALL).count() >= limits.maxTurns()) {
            throw rejected("TURN_LIMIT", "This attempt reached max_turns (" + limits.maxTurns() + ")");
        }
        if (limits.maxTokensTotal() != null) {
            long used = task.getAttemptPromptTokens() + task.getAttemptCompletionTokens();
            for (AgentStepEntity step : all) {
                used += (step.getPromptTokens() == null ? 0 : step.getPromptTokens())
                        + (step.getCompletionTokens() == null ? 0 : step.getCompletionTokens());
            }
            if (used >= limits.maxTokensTotal()) {
                throw rejected("TOKEN_LIMIT", "This task used " + used + " of max_tokens_total ("
                        + limits.maxTokensTotal() + ")");
            }
        }
        if (limits.budgetUsd() != null) {
            if (model == null || prices.priceAt(model, Instant.now()).isEmpty()) {
                throw rejected("BUDGET_UNPRICED", "Model '" + model + "' has no price, so budget_usd cannot be kept");
            }
            java.math.BigDecimal spent = task.getAttemptCostUsd() == null ? java.math.BigDecimal.ZERO
                    : task.getAttemptCostUsd();
            for (AgentStepEntity step : all) {
                if (step.getCostUsd() != null) spent = spent.add(step.getCostUsd());
            }
            if (spent.compareTo(limits.budgetUsd()) >= 0) {
                throw rejected("BUDGET", "This task spent $" + spent.stripTrailingZeros().toPlainString()
                        + " of budget_usd ($" + limits.budgetUsd().toPlainString() + ")");
            }
        }
    }

    /**
     * A write an earlier attempt completed with the same tool and arguments. The call id is the model's
     * own and differs between attempts, so it takes no part in the match.
     */
    private AgentStepEntity priorIdenticalWrite(ExternalTaskEntity task, String ref, JsonNode request) {
        String arguments = argumentsDigest(request);
        return steps.findByExternalTaskIdOrderByAttemptAscSequenceAsc(task.getId()).stream()
                .filter(step -> step.getAttempt() < task.getAttempt())
                .filter(step -> step.getKind() == Kind.TOOL_CALL && ref.equals(step.getToolRef()))
                .filter(step -> step.getState() == State.COMPLETED)
                .filter(step -> arguments.equals(argumentsDigest(decrypt(step.getRequestEnc()))))
                .findFirst().orElse(null);
    }

    private static String argumentsDigest(JsonNode request) {
        JsonNode arguments = request == null ? null : request.get("arguments");
        return digest(arguments == null ? request : arguments);
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
        if (step.getKind() == Kind.MODEL_CALL) return;
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

    /** The canonical (key-sorted) JSON of a payload, as digested and stored. */
    public static String canonicalJson(JsonNode payload) {
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
