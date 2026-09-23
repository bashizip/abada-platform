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
        Double confidence,
        Integer promptTokens,
        Integer completionTokens) {

    /** Protocol-v1 form without token usage (kept for older workers and callers). */
    public AgentAttemptMetadata(String model, String provider, Integer attempt, Long durationMs, List<String> tools,
            String resultVariable, String promptHash, String errorType, Double confidence) {
        this(model, provider, attempt, durationMs, tools, resultVariable, promptHash, errorType, confidence, null, null);
    }
}
