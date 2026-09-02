package io.abada.agent;

import io.abada.worker.AgentWorkDescriptor;
import java.net.URI;
import java.util.Map;

/** Google Gemini OpenAI-compatible gateway for {@code gemini*} and {@code google/} models. */
public final class GoogleGeminiGateway extends AbstractAgentGateway {

    public GoogleGeminiGateway(WorkerConfig config) {
        super(config);
    }

    @Override
    public String provider() {
        return "google-gemini";
    }

    @Override
    public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception {
        String model = blankToDefault(work.model(), config.defaultModel()).strip().replaceFirst("(?i)^google/", "");
        String rawPath = config.llmBaseUrl().getPath() == null ? "" : config.llmBaseUrl().getPath().replaceAll("/+$", "");
        String targetPath;
        if (rawPath.endsWith("/openai")) {
            targetPath = rawPath + "/chat/completions";
        } else if (rawPath.endsWith("/openai/chat/completions") || rawPath.endsWith("/chat/completions")) {
            targetPath = rawPath;
        } else {
            targetPath = rawPath + "/openai/chat/completions";
        }
        URI targetUri = config.llmBaseUrl().resolve(targetPath);
        return executeChatCompletion(targetUri, config.llmApiKey(), model, work, variables);
    }
}
