package io.abada.worker;

import java.util.List;

/** Optional attempt metadata an {@code abada:agent} worker reports on completion or failure. */
public record AgentAttemptMetadata(
        String model,
        String provider,
        Integer attempt,
        Long durationMs,
        List<String> tools,
        String resultVariable,
        String promptHash,
        String errorType,
        Double confidence) {
}
