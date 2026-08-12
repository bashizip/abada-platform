package io.abada.agent;

import io.abada.worker.AgentWorkDescriptor;
import java.util.Map;

/** Common contract for LLM provider gateways behind APL {@code agent} tasks. */
public interface AgentGateway {
    AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception;

    /** Stable provider family reported in attempt metadata, e.g. {@code openai-compatible}. */
    String provider();

    /** Decoded agent result plus the {@code _confidence} the model reported. */
    record AgentResult(Object value, Double confidence) {}

    /**
     * Carries the achieved {@code _confidence} across the throw boundary so a
     * below-threshold attempt still reports its score in failure metadata.
     */
    final class ConfidenceBelowThresholdException extends IllegalStateException {
        private final Double confidence;

        ConfidenceBelowThresholdException(double confidence) {
            super("Agent confidence is below the APL threshold");
            this.confidence = confidence;
        }

        Double confidence() {
            return confidence;
        }
    }
}
