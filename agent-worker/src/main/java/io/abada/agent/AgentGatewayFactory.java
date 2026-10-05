package io.abada.agent;

import io.abada.worker.AgentWorkDescriptor;
import java.util.Map;
import java.util.Optional;

/**
 * Routes a requested model to the provider endpoint that serves it (see
 * {@link ProviderCredentials}) and to the gateway for that provider: Gemini
 * endpoints use the Gemini gateway, every other provider the OpenAI-compatible
 * one. When a provider rejects the key, the engine's credentials are refreshed
 * once and the call retried if they changed (a key rotated in Studio).
 */
public final class AgentGatewayFactory {
    private final WorkerConfig config;
    private final ProviderCredentials credentials;

    /** Factory over the worker's own environment endpoints only. */
    public AgentGatewayFactory(WorkerConfig config) {
        this(config, ProviderCredentials.environmentOnly(config));
    }

    AgentGatewayFactory(WorkerConfig config, ProviderCredentials credentials) {
        this.config = config;
        this.credentials = credentials;
    }

    public AgentGateway gatewayFor(AgentWorkDescriptor work) {
        String model = work == null || work.model() == null || work.model().isBlank()
                ? config.defaultModel()
                : work.model();
        return new RefreshingGateway(model);
    }

    private AgentGateway concreteFor(String model) {
        Optional<ProviderEndpoint> endpoint = credentials.resolve(model);
        if (endpoint.isEmpty()) return new UnconfiguredGateway(model);
        return endpoint.get().isGemini()
                ? new GoogleGeminiGateway(config, endpoint.get())
                : new OpenAiCompatibleGateway(config, endpoint.get());
    }

    /** Resolves per task and retries once with fresh credentials after an authentication failure. */
    final class RefreshingGateway implements AgentGateway {
        private final String model;
        private volatile AgentGateway delegate;

        RefreshingGateway(String model) {
            this.model = model;
            this.delegate = concreteFor(model);
        }

        AgentGateway delegate() {
            return delegate;
        }

        @Override
        public String provider() {
            return delegate.provider();
        }

        @Override
        public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception {
            try {
                return delegate.execute(work, variables);
            } catch (AgentAuthenticationException rejected) {
                if (!credentials.refresh()) throw rejected;
                delegate = concreteFor(model);
                return delegate.execute(work, variables);
            }
        }

        @Override
        public ChatTurn chat(AgentWorkDescriptor work, String chatModel, java.util.List<Map<String, Object>> messages,
                java.util.List<ToolSpec> tools) throws Exception {
            try {
                return delegate.chat(work, chatModel, messages, tools);
            } catch (AgentAuthenticationException rejected) {
                if (!credentials.refresh()) throw rejected;
                delegate = concreteFor(model);
                return delegate.chat(work, chatModel, messages, tools);
            }
        }
    }

    /** No provider serves the model: fail the attempt with a message saying where to add one. */
    static final class UnconfiguredGateway implements AgentGateway {
        private final String model;

        UnconfiguredGateway(String model) {
            this.model = model;
        }

        @Override
        public String provider() {
            return "unconfigured";
        }

        @Override
        public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) {
            throw new AgentConfigurationException("No AI provider is configured for model '" + model
                    + "'. Add the provider and its API key in Studio Settings > AI Providers.");
        }

        @Override
        public ChatTurn chat(AgentWorkDescriptor work, String chatModel, java.util.List<Map<String, Object>> messages,
                java.util.List<ToolSpec> tools) {
            throw new AgentConfigurationException("No AI provider is configured for model '" + model
                    + "'. Add the provider and its API key in Studio Settings > AI Providers.");
        }
    }
}
