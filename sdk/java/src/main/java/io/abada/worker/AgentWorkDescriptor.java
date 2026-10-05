package io.abada.worker;

import java.util.List;
import java.util.Map;

/**
 * Optional agent profile transported by external-worker protocol v1.
 *
 * @param fallbackModels models to try, in order, when the model before is
 *        unavailable (rate limit, quota, outage); empty when none are declared
 * @param toolPolicies policies the node tightened for some tool refs; empty when none
 * @param toolBindings the tools this work may use, frozen at deployment; empty
 *        when the node binds none (names in {@code tools} without a server are advisory)
 * @param prices current prices of the node's model and fallbacks (for budgets);
 *        the engine prices calls itself, so a worker never reports cost
 * @param limits bounds of the tool loop; null when the node declares none
 * @param delegates processes the agent may delegate to; empty when none
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
        List<String> fallbackModels,
        Map<String, String> toolPolicies,
        List<ToolBinding> toolBindings,
        Map<String, ModelPrice> prices,
        AgentLimits limits,
        List<AgentDelegate> delegates) {

    public AgentWorkDescriptor {
        delegates = delegates == null ? List.of() : List.copyOf(delegates);
        fallbackModels = fallbackModels == null ? List.of() : List.copyOf(fallbackModels);
        toolPolicies = toolPolicies == null ? Map.of() : Map.copyOf(toolPolicies);
        toolBindings = toolBindings == null ? List.of() : List.copyOf(toolBindings);
        prices = prices == null ? Map.of() : Map.copyOf(prices);
    }

    /** Descriptor without delegations (protocol v1 before E20b). */
    public AgentWorkDescriptor(String profileVersion, String model, String prompt, Map<String, String> inputs,
            String resultVariable, Map<String, Object> outputSchema, List<String> tools, Double confidenceThreshold,
            Double temperature, Integer maxTokens, Long timeoutMs, Integer maxAttempts, Long retryBackoffMs,
            List<String> fallbackModels, Map<String, String> toolPolicies, List<ToolBinding> toolBindings,
            Map<String, ModelPrice> prices, AgentLimits limits) {
        this(profileVersion, model, prompt, inputs, resultVariable, outputSchema, tools, confidenceThreshold,
                temperature, maxTokens, timeoutMs, maxAttempts, retryBackoffMs, fallbackModels, toolPolicies,
                toolBindings, prices, limits, List.of());
    }

    /** Descriptor without loop limits. */
    public AgentWorkDescriptor(String profileVersion, String model, String prompt, Map<String, String> inputs,
            String resultVariable, Map<String, Object> outputSchema, List<String> tools, Double confidenceThreshold,
            Double temperature, Integer maxTokens, Long timeoutMs, Integer maxAttempts, Long retryBackoffMs,
            List<String> fallbackModels, Map<String, String> toolPolicies, List<ToolBinding> toolBindings,
            Map<String, ModelPrice> prices) {
        this(profileVersion, model, prompt, inputs, resultVariable, outputSchema, tools, confidenceThreshold,
                temperature, maxTokens, timeoutMs, maxAttempts, retryBackoffMs, fallbackModels, toolPolicies,
                toolBindings, prices, null);
    }

    /** Descriptor without prices (protocol v1 before 1.1.0-rc.2). */
    public AgentWorkDescriptor(String profileVersion, String model, String prompt, Map<String, String> inputs,
            String resultVariable, Map<String, Object> outputSchema, List<String> tools, Double confidenceThreshold,
            Double temperature, Integer maxTokens, Long timeoutMs, Integer maxAttempts, Long retryBackoffMs,
            List<String> fallbackModels, Map<String, String> toolPolicies, List<ToolBinding> toolBindings) {
        this(profileVersion, model, prompt, inputs, resultVariable, outputSchema, tools, confidenceThreshold,
                temperature, maxTokens, timeoutMs, maxAttempts, retryBackoffMs, fallbackModels, toolPolicies,
                toolBindings, Map.of());
    }

    /** Descriptor without tool bindings (protocol v1 before 1.1.0-rc.2). */
    public AgentWorkDescriptor(String profileVersion, String model, String prompt, Map<String, String> inputs,
            String resultVariable, Map<String, Object> outputSchema, List<String> tools, Double confidenceThreshold,
            Double temperature, Integer maxTokens, Long timeoutMs, Integer maxAttempts, Long retryBackoffMs,
            List<String> fallbackModels) {
        this(profileVersion, model, prompt, inputs, resultVariable, outputSchema, tools, confidenceThreshold,
                temperature, maxTokens, timeoutMs, maxAttempts, retryBackoffMs, fallbackModels, Map.of(), List.of(),
                Map.of());
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
                fallbackModels, toolPolicies, toolBindings, prices, limits, delegates);
    }
}
