package com.abada.engine.core.model;

import java.io.Serializable;
import java.util.List;

/**
 * Optional, additive attempt metadata an {@code abada:agent} worker reports
 * for a single model call through the durable completion and failure
 * commands. The engine persists it on the external-task record and in
 * activity history so model attempts and results are observable without
 * logging prompts, tokens, credentials, or complete sensitive payloads.
 */
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
        Integer completionTokens) implements Serializable {

    public AgentAttemptMetadata {
        tools = tools == null ? List.of() : List.copyOf(tools);
    }

    /** Protocol-v1 form without token usage (kept for older workers and callers). */
    public AgentAttemptMetadata(String model, String provider, Integer attempt, Long durationMs, List<String> tools,
            String resultVariable, String promptHash, String errorType, Double confidence) {
        this(model, provider, attempt, durationMs, tools, resultVariable, promptHash, errorType, confidence, null, null);
    }
}
