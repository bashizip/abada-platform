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
        return executeChatCompletion(target(), endpoint.apiKey(), upstream(work.model()), work, variables);
    }

    @Override
    public ChatTurn chat(AgentWorkDescriptor work, String model, List<Map<String, Object>> messages,
            List<ToolSpec> tools) throws Exception {
        return sendChat(target(), endpoint.apiKey(), upstream(model), work, messages, tools);
    }

    private String upstream(String model) {
        return endpoint.upstreamModel(blankToDefault(model,
                blankToDefault(endpoint.defaultModel(), config.defaultModel())));
    }

    private URI target() {
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
        return base.resolve(targetPath);
    }
}
