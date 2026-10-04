package io.abada.worker;

import java.util.List;
import java.util.Map;

/**
 * Optional agent profile transported by external-worker protocol v1.
 *
 * @param fallbackModels models to try, in order, when the model before is
 *        unavailable (rate limit, quota, outage); empty when none are declared
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
        List<String> fallbackModels) {

    public AgentWorkDescriptor {
        fallbackModels = fallbackModels == null ? List.of() : List.copyOf(fallbackModels);
    }

    /** Descriptor without fallback models (protocol v1 before 1.1). */
    public AgentWorkDescriptor(String profileVersion, String model, String prompt, Map<String, String> inputs,
            String resultVariable, Map<String, Object> outputSchema, List<String> tools, Double confidenceThreshold,
            Double temperature, Integer maxTokens, Long timeoutMs, Integer maxAttempts, Long retryBackoffMs) {
        this(profileVersion, model, prompt, inputs, resultVariable, outputSchema, tools, confidenceThreshold,
                temperature, maxTokens, timeoutMs, maxAttempts, retryBackoffMs, List.of());
    }

    /** The same work for another model (a declared fallback). */
    public AgentWorkDescriptor withModel(String otherModel) {
        return new AgentWorkDescriptor(profileVersion, otherModel, prompt, inputs, resultVariable, outputSchema,
                tools, confidenceThreshold, temperature, maxTokens, timeoutMs, maxAttempts, retryBackoffMs,
                fallbackModels);
    }
}
