package com.abada.engine.core.model;

import com.fasterxml.jackson.annotation.JsonInclude;

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
        Long retryBackoffMs,
        // Omitted when empty, so workers built before fallback models still decode the descriptor.
        @JsonInclude(JsonInclude.Include.NON_EMPTY) List<String> fallbackModels,
        // Policies a node tightened for some of its tool refs (ref -> policy); omitted when none.
        @JsonInclude(JsonInclude.Include.NON_EMPTY) Map<String, ToolPolicy> toolPolicies,
        // Resolved at deployment and attached when the work is locked; never parsed from the source.
        @JsonInclude(JsonInclude.Include.NON_EMPTY) List<ToolBinding> toolBindings) implements Serializable {

    public AgentWorkDescriptor {
        inputs = inputs == null ? Map.of() : Map.copyOf(inputs);
        outputSchema = outputSchema == null ? Map.of() : Map.copyOf(outputSchema);
        tools = tools == null ? List.of() : List.copyOf(tools);
        fallbackModels = fallbackModels == null ? List.of() : List.copyOf(fallbackModels);
        toolPolicies = toolPolicies == null ? Map.of() : Map.copyOf(toolPolicies);
        toolBindings = toolBindings == null ? List.of() : List.copyOf(toolBindings);
    }

    public AgentWorkDescriptor(String profileVersion, String model, String prompt, Map<String, String> inputs,
            String resultVariable, Map<String, Object> outputSchema, List<String> tools, Double confidenceThreshold,
            Double temperature, Integer maxTokens, Long timeoutMs, Integer maxAttempts, Long retryBackoffMs,
            List<String> fallbackModels) {
        this(profileVersion, model, prompt, inputs, resultVariable, outputSchema, tools, confidenceThreshold,
                temperature, maxTokens, timeoutMs, maxAttempts, retryBackoffMs, fallbackModels, Map.of(), List.of());
    }

    public AgentWorkDescriptor(String profileVersion, String model, String prompt, Map<String, String> inputs,
            String resultVariable, Map<String, Object> outputSchema, List<String> tools, Double confidenceThreshold,
            Double temperature, Integer maxTokens, Long timeoutMs, Integer maxAttempts, Long retryBackoffMs) {
        this(profileVersion, model, prompt, inputs, resultVariable, outputSchema, tools, confidenceThreshold,
                temperature, maxTokens, timeoutMs, maxAttempts, retryBackoffMs, List.of());
    }

    /** The same work for another model: the operator's override or a declared fallback. */
    public AgentWorkDescriptor withModel(String otherModel) {
        return new AgentWorkDescriptor(profileVersion, otherModel, prompt, inputs, resultVariable, outputSchema,
                tools, confidenceThreshold, temperature, maxTokens, timeoutMs, maxAttempts, retryBackoffMs,
                fallbackModels, toolPolicies, toolBindings);
    }

    /** The same work with the tool bindings frozen for its definition version. */
    public AgentWorkDescriptor withToolBindings(List<ToolBinding> bindings) {
        return new AgentWorkDescriptor(profileVersion, model, prompt, inputs, resultVariable, outputSchema,
                tools, confidenceThreshold, temperature, maxTokens, timeoutMs, maxAttempts, retryBackoffMs,
                fallbackModels, toolPolicies, bindings);
    }
}
