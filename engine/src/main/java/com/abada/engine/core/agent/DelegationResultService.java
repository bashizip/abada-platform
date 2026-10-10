package com.abada.engine.core.agent;

import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.DelegationMeta;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.persistence.entity.AgentStepEntity;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.repository.AgentStepRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The end of a child an agent delegated to (E20b), run by the child's
 * idempotent {@code CHILD_DONE} job. The delegation step finishes with the
 * child's declared outputs (or its status when it did not complete), and the
 * agent's parked work becomes acquirable again. The parent token never moves:
 * the agent continues its conversation with the result.
 */
@Service
public class DelegationResultService {
    private final AgentStepRepository steps;
    private final ExternalTaskRepository externalTasks;
    private final AgentStepService stepService;
    private final AbadaEngine engine;
    private final ActivityHistoryService history;

    public DelegationResultService(AgentStepRepository steps, ExternalTaskRepository externalTasks,
            AgentStepService stepService, AbadaEngine engine, ActivityHistoryService history) {
        this.steps = steps;
        this.externalTasks = externalTasks;
        this.stepService = stepService;
        this.engine = engine;
        this.history = history;
    }

    /**
     * Applies a delegated child's end. Locks the agent's external task, then
     * re-reads the step under it; the parent instance is read, never locked.
     *
     * @return false when the child was not started by a delegation (a call-process child)
     */
    @Transactional
    public boolean childEnded(String childInstanceId) {
        AgentStepEntity found = steps.findByChildInstanceId(childInstanceId).orElse(null);
        if (found == null) return false;
        ExternalTaskEntity work = externalTasks.findByIdForUpdate(found.getExternalTaskId()).orElse(null);
        AgentStepEntity step = steps.findById(found.getId()).orElseThrow();
        ProcessInstance parent = engine.getProcessInstanceById(step.getProcessInstanceId());
        if (parent == null) return true;
        if (work == null || work.getStatus() != ExternalTaskEntity.Status.AWAITING_CHILD
                || step.getState() != AgentStepEntity.State.STARTED) {
            // Retired meanwhile (cancel, timeout) or already applied: nothing to resume.
            history.record("CHILD_RESULT_IGNORED", parent, step.getActivityId(),
                    Map.of("childInstanceId", childInstanceId, "reason", "the delegation no longer waits"));
            return true;
        }
        ProcessInstance child = engine.getProcessInstanceById(childInstanceId);
        DelegationMeta delegate = parent.getDefinition().getDelegations(step.getActivityId()).stream()
                .filter(candidate -> candidate.toolRef().equals(step.getToolRef())).findFirst().orElse(null);
        boolean completed = child != null && child.getStatus() == ProcessStatus.COMPLETED;
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", child == null ? "MISSING" : child.getStatus().name());
        result.put("childInstanceId", childInstanceId);
        List<String> missing = new ArrayList<>();
        if (completed) {
            // Default-deny: only the outputs the delegate declares come back.
            Map<String, Object> outputs = new LinkedHashMap<>();
            for (String name : delegate == null ? List.<String>of() : delegate.outputs()) {
                if (!child.getVariables().containsKey(name)) missing.add(name);
                outputs.put(name, child.getVariables().get(name));
            }
            result.put("outputs", outputs);
        }
        stepService.finishDelegation(step, parent, completed, result);
        work.setStatus(ExternalTaskEntity.Status.OPEN);
        work.setWorkerId(null);
        work.setLockExpirationTime(null);
        externalTasks.save(work);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("externalTaskId", work.getId());
        details.put("sequence", step.getSequence());
        details.put("childInstanceId", childInstanceId);
        details.put("status", result.get("status"));
        if (delegate != null) details.put("process", delegate.process());
        if (completed) details.put("outputs", delegate == null ? List.of() : delegate.outputs());
        if (!missing.isEmpty()) details.put("missingChildVariables", missing);
        history.record("DELEGATION_COMPLETED", parent, step.getActivityId(), details);
        return true;
    }
}
