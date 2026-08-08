package com.abada.engine.core.model;

import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * Immutable, versioned instructions attached to an APL {@code agent} node.
 * The engine only transports this contract to an external worker; it never
 * performs the remote model call inside a workflow-state transaction.
 */
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
        Long retryBackoffMs) implements Serializable {

    public AgentWorkDescriptor {
        inputs = inputs == null ? Map.of() : Map.copyOf(inputs);
        outputSchema = outputSchema == null ? Map.of() : Map.copyOf(outputSchema);
        tools = tools == null ? List.of() : List.copyOf(tools);
    }
}
