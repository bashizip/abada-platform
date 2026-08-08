package io.abada.worker;

import java.time.Instant;
import java.util.Map;

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
        AgentWorkDescriptor agentWork) {
}
