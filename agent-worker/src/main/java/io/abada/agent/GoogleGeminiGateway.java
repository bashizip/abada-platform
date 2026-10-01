package io.abada.agent;

import io.abada.worker.AgentWorkDescriptor;
import java.net.URI;
import java.util.List;
import java.util.Map;

/** Google Gemini OpenAI-compatible gateway for {@code gemini*} and {@code google/} models. */
public final class GoogleGeminiGateway extends AbstractAgentGateway {
    private final ProviderEndpoint endpoint;

    /** Gateway over the worker's own {@code ABADA_AGENT_LLM_*} endpoint. */
    public GoogleGeminiGateway(WorkerConfig config) {
        this(config, new ProviderEndpoint("worker-env-gemini", "gemini", config.llmBaseUrl(), config.llmApiKey(),
                List.of("gemini", "google/"), config.defaultModel(), false,
                ProviderEndpoint.Source.WORKER_ENVIRONMENT));
    }

    GoogleGeminiGateway(WorkerConfig config, ProviderEndpoint endpoint) {
        super(config);
        this.endpoint = endpoint;
    }

    @Override
    public String provider() {
        return "google-gemini";
    }

    @Override
    public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception {
        String model = endpoint.upstreamModel(blankToDefault(work.model(),
                blankToDefault(endpoint.defaultModel(), config.defaultModel())));
        URI base = requireBaseUrl(endpoint);
        String rawPath = base.getPath() == null ? "" : base.getPath().replaceAll("/+$", "");
        String targetPath;
        if (rawPath.endsWith("/openai")) {
            targetPath = rawPath + "/chat/completions";
        } else if (rawPath.endsWith("/openai/chat/completions") || rawPath.endsWith("/chat/completions")) {
            targetPath = rawPath;
        } else {
            targetPath = rawPath + "/openai/chat/completions";
        }
        return executeChatCompletion(base.resolve(targetPath), endpoint.apiKey(), model, work, variables);
    }
}
