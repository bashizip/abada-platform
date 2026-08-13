package com.abada.engine.dto;

import java.time.Instant;

/**
 * Liveness and incident summary for one worker/topic combination in a
 * project. `bound` distinguishes a worker that holds a project binding from
 * a rejected caller whose failures are still surfaced for monitoring.
 */
public record WorkerHealthDTO(
        String projectId,
        String principalId,
        String principalUsername,
        String topic,
        boolean bound,
        String status,
        Instant lastSeenAt,
        Instant lastSuccessAt,
        Instant lastErrorAt,
        String lastErrorMessage,
        int consecutiveFailures,
        String lastWorkerId) {
}