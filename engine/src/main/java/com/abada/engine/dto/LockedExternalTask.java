package com.abada.engine.dto;

import java.util.Map;
import java.time.Instant;
import com.abada.engine.core.model.AgentWorkDescriptor;

/**
 * Represents an external task that has been locked for a worker.
 * This is the payload returned by the fetch-and-lock API.
 *
 * @param id The unique ID of the external task.
 * @param topicName The topic of the task.
 * @param variables The process variables available to the task.
 * @param projectId The project the task belongs to; present on global
 *        (project-agnostic) acquisitions so the worker can scope its work
 *        and downstream API calls.
 */
public record LockedExternalTask(
        String id,
        String topicName,
        Map<String, Object> variables,
        String processInstanceId,
        String activityId,
        Integer retries,
        Instant lockExpirationTime,
        String traceParent,
        String protocolVersion,
        AgentWorkDescriptor agentWork,
        String projectId,
        // E9 (additive): the attempt the task is on, the journaled steps of that
        // attempt to resume from, and writes earlier attempts completed.
        Integer attempt,
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_EMPTY)
        java.util.List<AgentStepDto> steps,
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_EMPTY)
        java.util.List<AgentStepDto> priorWrites) {

    public LockedExternalTask {
        steps = steps == null ? java.util.List.of() : java.util.List.copyOf(steps);
        priorWrites = priorWrites == null ? java.util.List.of() : java.util.List.copyOf(priorWrites);
    }

    public LockedExternalTask(String id, String topicName, Map<String, Object> variables,
            String processInstanceId, String activityId, Integer retries, Instant lockExpirationTime,
            String traceParent, String protocolVersion, AgentWorkDescriptor agentWork, String projectId) {
        this(id, topicName, variables, processInstanceId, activityId, retries, lockExpirationTime, traceParent,
                protocolVersion, agentWork, projectId, null, null, null);
    }

    public LockedExternalTask(String id, String topicName, Map<String, Object> variables) {
        this(id, topicName, variables, null, null, null, null, null, "1", null, null);
    }
}
