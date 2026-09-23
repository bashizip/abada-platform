package io.abada.agent;

import io.abada.worker.AgentWorkDescriptor;
import java.util.Map;

/** Common contract for LLM provider gateways behind APL {@code agent} tasks. */
public interface AgentGateway {
    AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception;

    /** Stable provider family reported in attempt metadata, e.g. {@code openai-compatible}. */
    String provider();

    /**
     * Decoded agent result, the {@code _confidence} the model reported, and the
     * provider's token usage when available. The engine, not the worker, decides
     * whether the result satisfies the node's output contract.
     */
    record AgentResult(Object value, Double confidence, Integer promptTokens, Integer completionTokens) {
        public AgentResult(Object value, Double confidence) {
            this(value, confidence, null, null);
        }
    }

    /**
     * Carries the achieved {@code _confidence} across the throw boundary so a
     * below-threshold attempt still reports its score in failure metadata.
     */
    final class ConfidenceBelowThresholdException extends IllegalStateException {
        private final Double confidence;

        public ConfidenceBelowThresholdException(double confidence) {
            super("Agent confidence is below the APL threshold");
            this.confidence = confidence;
        }

        public Double confidence() {
            return confidence;
        }
    }

    class AgentGatewayException extends IllegalStateException {
        public AgentGatewayException(String message) {
            super(message);
        }

        public AgentGatewayException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    class AgentConfigurationException extends AgentGatewayException {
        public AgentConfigurationException(String message) {
            super(message);
        }
    }

    class AgentAuthenticationException extends AgentGatewayException {
        public AgentAuthenticationException(String message) {
            super(message);
        }
    }

    class AgentModelNotFoundException extends AgentGatewayException {
        public AgentModelNotFoundException(String message) {
            super(message);
        }
    }

    class AgentQuotaExceededException extends AgentGatewayException {
        public AgentQuotaExceededException(String message) {
            super(message);
        }
    }

    class AgentUnreachableException extends AgentGatewayException {
        public AgentUnreachableException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    class AgentExecutionException extends AgentGatewayException {
        public AgentExecutionException(String message) {
            super(message);
        }
    }
}

