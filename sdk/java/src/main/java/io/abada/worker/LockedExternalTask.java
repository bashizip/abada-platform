package io.abada.worker;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * A locked task. For agent work, {@code attempt} is the attempt the task is
 * on, {@code steps} the journaled steps of that attempt to resume from, and
 * {@code priorWrites} the writes earlier attempts completed (all empty when
 * there are none, and absent from engines before 1.1.0-rc.2).
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
        Integer attempt,
        List<AgentStep> steps,
        List<AgentStep> priorWrites) {

    public LockedExternalTask {
        steps = steps == null ? List.of() : List.copyOf(steps);
        priorWrites = priorWrites == null ? List.of() : List.copyOf(priorWrites);
    }

    public LockedExternalTask(String id, String topicName, Map<String, Object> variables, String processInstanceId,
            String activityId, Integer retries, Instant lockExpirationTime, String traceParent,
            String protocolVersion, AgentWorkDescriptor agentWork, String projectId) {
        this(id, topicName, variables, processInstanceId, activityId, retries, lockExpirationTime, traceParent,
                protocolVersion, agentWork, projectId, null, null, null);
    }
}
