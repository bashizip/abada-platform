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
        Integer completionTokens,
        // The node's declared model when the worker ran a fallback model instead (null otherwise).
        String requestedModel) {

    /** Protocol-v1 form without token usage (kept for older workers and callers). */
    public AgentAttemptMetadata(String model, String provider, Integer attempt, Long durationMs, List<String> tools,
            String resultVariable, String promptHash, String errorType, Double confidence) {
        this(model, provider, attempt, durationMs, tools, resultVariable, promptHash, errorType, confidence, null, null);
    }

    /** Form with token usage and no fallback (kept for callers built before fallback models). */
    public AgentAttemptMetadata(String model, String provider, Integer attempt, Long durationMs, List<String> tools,
            String resultVariable, String promptHash, String errorType, Double confidence, Integer promptTokens,
            Integer completionTokens) {
        this(model, provider, attempt, durationMs, tools, resultVariable, promptHash, errorType, confidence,
                promptTokens, completionTokens, null);
    }
}
