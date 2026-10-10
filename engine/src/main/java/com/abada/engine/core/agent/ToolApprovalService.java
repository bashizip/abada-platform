package com.abada.engine.core.agent;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.core.AtomicRuntimeCommand;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.TaskManager;
import com.abada.engine.core.model.OutcomeMeta;
import com.abada.engine.core.model.ServiceTaskMeta;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.dto.ToolApprovalDto;
import com.abada.engine.persistence.entity.AgentStepEntity;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.AgentStepRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.project.TaskGroupResolver;
import com.abada.engine.security.AbadaRoles;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Approval of {@code approval_required} tool calls (E10). An agent proposes a
 * call, its work parks, and a person in the binding's approver groups decides
 * on exactly the proposed arguments. The approval is a human task that is not
 * a process node: deciding it never moves the token, it only makes the agent's
 * work acquirable again, with the decision journaled on the step.
 */
@Service
public class ToolApprovalService {
    public static final String APPROVE = "approve";
    public static final String REJECT = "reject";
    /** The fixed outcomes of every tool approval; a rejection carries its reason. */
    public static final List<OutcomeMeta> OUTCOMES = List.of(new OutcomeMeta(APPROVE, false, null),
            new OutcomeMeta(REJECT, true, null));

    private static final Set<ExternalTaskEntity.Status> RETIRED = Set.of(ExternalTaskEntity.Status.COMPLETED,
            ExternalTaskEntity.Status.CANCELLED, ExternalTaskEntity.Status.FAILED,
            ExternalTaskEntity.Status.BPMN_ERROR);

    private final AbadaEngine engine;
    private final TaskManager taskManager;
    private final TaskRepository tasks;
    private final ExternalTaskRepository externalTasks;
    private final AgentStepRepository steps;
    private final AgentStepService stepService;
    private final TaskGroupResolver groups;
    private final ActivityHistoryService history;

    public ToolApprovalService(AbadaEngine engine, TaskManager taskManager, TaskRepository tasks,
            ExternalTaskRepository externalTasks, AgentStepRepository steps, AgentStepService stepService,
            TaskGroupResolver groups, ActivityHistoryService history) {
        this.engine = engine;
        this.taskManager = taskManager;
        this.tasks = tasks;
        this.externalTasks = externalTasks;
        this.steps = steps;
        this.stepService = stepService;
        this.groups = groups;
        this.history = history;
    }

    /**
     * A decision on any human task: a tool approval is decided here, every
     * other task through the process's own decision command.
     */
    public void decideTask(String taskId, String user, List<String> userGroups, String outcome, String comment,
            Map<String, Object> variables) {
        boolean approval = tasks.findById(taskId).map(task -> TaskInstance.KIND_TOOL_APPROVAL.equals(task.getKind()))
                .orElse(false);
        if (approval) {
            decide(taskId, user, userGroups, outcome, comment, variables);
        } else {
            engine.decideTask(taskId, user, userGroups, outcome, comment, variables);
        }
    }

    /**
     * Approves or rejects one proposed call. Locks the agent's external task,
     * then the approval task (the order a timeout boundary takes), never the
     * instance. A worker credential may not decide, whatever else it holds.
     */
    @AtomicRuntimeCommand
    public void decide(String taskId, String user, List<String> userGroups, String outcome, String comment,
            Map<String, Object> variables) {
        refuseWorkerCredential();
        TaskEntity unlocked = tasks.findById(taskId).orElseThrow(() -> notFound(taskId));
        AgentStepEntity step = unlocked.getAgentStepId() == null ? null
                : steps.findById(unlocked.getAgentStepId()).orElse(null);
        if (step == null) throw notFound(taskId);
        ExternalTaskEntity work = externalTasks.findByIdForUpdate(step.getExternalTaskId())
                .orElseThrow(() -> notFound(taskId));
        TaskEntity task = tasks.findByIdForUpdate(taskId).orElseThrow(() -> notFound(taskId));
        ProcessInstance instance = engine.getProcessInstanceById(task.getProcessInstanceId());
        if (instance == null) throw notFound(taskId);

        if (task.getStatus() == TaskStatus.CANCELLED || RETIRED.contains(work.getStatus())) {
            throw new ApiException(HttpStatus.GONE, ApiErrorCode.WORK_RETIRED, "The agent work this task approves"
                    + " was retired; the call will not run");
        }
        String principalId = IdentityContext.get().map(Identity::principalId).orElse(null);
        List<String> effective = groups.effectiveGroups(instance.getProjectId(), principalId, userGroups);
        taskManager.checkCanComplete(taskManager.materialize(task), user, effective);

        String chosen = outcome == null ? "" : outcome.strip();
        if (!APPROVE.equals(chosen) && !REJECT.equals(chosen)) {
            throw invalid("A tool approval's outcome is approve or reject");
        }
        String reason = comment == null || comment.isBlank() ? null : comment.strip();
        if (REJECT.equals(chosen) && reason == null) throw invalid("A rejection needs a comment the agent can read");
        if (reason != null && reason.length() > OutcomeMeta.MAX_COMMENT_LENGTH) {
            throw invalid("comment exceeds " + OutcomeMeta.MAX_COMMENT_LENGTH + " characters");
        }
        if (variables != null && !variables.isEmpty()) {
            throw invalid("A tool approval sets no process variables");
        }
        // The step moves only under its external task's lock, which we hold; re-read it inside it.
        step = steps.findById(step.getId()).orElseThrow(() -> notFound(taskId));
        if (work.getStatus() != ExternalTaskEntity.Status.AWAITING_APPROVAL) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "The agent work is not waiting for this approval");
        }

        boolean approved = APPROVE.equals(chosen);
        stepService.decide(step, instance, approved, reason, user);
        task.setStatus(TaskStatus.COMPLETED);
        task.setEndDate(Instant.now());
        if (task.getAssignee() == null) task.setAssignee(user);
        tasks.save(task);
        work.setStatus(ExternalTaskEntity.Status.OPEN);
        externalTasks.save(work);
        engine.retireApprovalTimer(task.getProcessInstanceId(), task.getTokenId());

        Map<String, Object> completed = new LinkedHashMap<>();
        completed.put("outcome", chosen);
        completed.put("commented", reason != null);
        completed.put("commentLength", reason == null ? 0 : reason.length());
        history.record("TASK_COMPLETED", instance, task.getTaskDefinitionKey(), completed);
        Map<String, Object> decided = new LinkedHashMap<>();
        decided.put("taskId", task.getId());
        decided.put("toolRef", step.getToolRef());
        decided.put("sequence", step.getSequence());
        decided.put("argumentsDigest", step.getRequestDigest());
        decided.put("outcome", chosen);
        decided.put("commentLength", reason == null ? 0 : reason.length());
        history.record("TOOL_APPROVAL_DECIDED", instance, task.getTaskDefinitionKey(), decided);
    }

    /** What the approver sees: the tool, the agent and the arguments as the evidence policy keeps them. */
    @Transactional(readOnly = true)
    public ToolApprovalDto view(TaskInstance task, ProcessInstance instance) {
        if (task == null || !task.isToolApproval() || task.getAgentStepId() == null) return null;
        AgentStepEntity step = steps.findById(task.getAgentStepId()).orElse(null);
        if (step == null) return null;
        String ref = step.getToolRef();
        int slash = ref == null ? -1 : ref.indexOf('/');
        String model = null;
        if (instance != null) {
            ServiceTaskMeta meta = instance.getDefinition().getServiceTask(step.getActivityId());
            if (meta != null && meta.agentWork() != null) model = meta.agentWork().model();
        }
        return new ToolApprovalDto(ref, slash < 0 ? null : ref.substring(0, slash),
                slash < 0 ? ref : ref.substring(slash + 1), step.getActivityId(), model, step.getAttempt(),
                step.getSequence(), step.getRequestDigest(), stepService.proposedArguments(step),
                step.getPayloadMode(), step.getStartedAt(), step.getState().name());
    }

    /** The worker scope or role, from a token or from trusted identity groups. */
    private static void refuseWorkerCredential() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        boolean worker = authentication != null && authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch(name -> "SCOPE_worker:execute".equals(name) || AbadaRoles.WORKER.equals(name));
        worker = worker || IdentityContext.get().map(Identity::groups).orElseGet(List::of).stream()
                .anyMatch(group -> AbadaRoles.WORKER.equals(AbadaRoles.fromGroup(group)));
        if (worker) {
            throw new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                    "A worker credential cannot decide a tool approval");
        }
    }

    private static ApiException notFound(String taskId) {
        return new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "Task not found: " + taskId);
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, message);
    }
}
