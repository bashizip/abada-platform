package io.abada.agent;

import io.abada.worker.AgentWorkDescriptor;
import java.net.URI;
import java.util.List;
import java.util.Map;

/**
 * OpenAI-compatible {@code /chat/completions} gateway: OpenAI, Anthropic,
 * DeepSeek, OpenRouter and any OpenAI-compatible endpoint.
 */
public final class OpenAiCompatibleGateway extends AbstractAgentGateway {
    private final ProviderEndpoint endpoint;

    /** Gateway over the worker's own {@code ABADA_AGENT_OPENAI_*} endpoint. */
    public OpenAiCompatibleGateway(WorkerConfig config) {
        this(config, new ProviderEndpoint("worker-env-openai", "openai-compatible", config.openAiBaseUrl(),
                config.openAiApiKey(), List.of("*"), config.defaultModel(), true,
                ProviderEndpoint.Source.WORKER_ENVIRONMENT));
    }

    OpenAiCompatibleGateway(WorkerConfig config, ProviderEndpoint endpoint) {
        super(config);
        this.endpoint = endpoint;
    }

    /** The provider type ({@code anthropic}, {@code openrouter}, ...) or {@code openai-compatible}. */
    @Override
    public String provider() {
        return endpoint.type() == null || endpoint.type().isBlank() ? "openai-compatible" : endpoint.type();
    }

    @Override
    public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception {
        String model = endpoint.upstreamModel(blankToDefault(work.model(),
                blankToDefault(endpoint.defaultModel(), config.defaultModel())));
        URI base = requireBaseUrl(endpoint);
        String rawPath = base.getPath() == null ? "" : base.getPath().replaceAll("/+$", "");
        String targetPath = rawPath.endsWith("/chat/completions") ? rawPath : rawPath + "/chat/completions";
        return executeChatCompletion(base.resolve(targetPath), endpoint.apiKey(), model, work, variables);
    }
}
