package io.abada.worker;

import java.util.List;
import java.util.Map;

/** Optional agent profile transported by external-worker protocol v1. */
public record AgentWorkDescriptor(
        String profileVersion,
        String model,
        String prompt,
        Map<String, String> inputs,
        String resultVariable,
        Map<String, Object> outputSchema,
        List<String> tools,
        Double confidenceThreshold,
        Double temperature,
        Integer maxTokens,
        Long timeoutMs,
        Integer maxAttempts,
        Long retryBackoffMs) {
}
