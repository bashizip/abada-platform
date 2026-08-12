package io.abada.agent;

import io.abada.worker.AgentWorkDescriptor;
import java.util.Locale;

/**
 * Routes a requested model name to the concrete {@link AgentGateway} that can
 * serve it. Models named {@code gemini*} or prefixed {@code google/} use the
 * Gemini gateway; everything else uses the OpenAI-compatible gateway.
 */
public final class AgentGatewayFactory {
    private final WorkerConfig config;
    private final OpenAiCompatibleGateway openAi;
    private final GoogleGeminiGateway gemini;

    public AgentGatewayFactory(WorkerConfig config) {
        this.config = config;
        this.openAi = new OpenAiCompatibleGateway(config);
        this.gemini = new GoogleGeminiGateway(config);
    }

    public AgentGateway gatewayFor(AgentWorkDescriptor work) {
        String model = work == null || work.model() == null || work.model().isBlank()
                ? config.defaultModel()
                : work.model();
        return isGeminiModel(model) ? gemini : openAi;
    }

    private static boolean isGeminiModel(String model) {
        String normalized = model.strip().toLowerCase(Locale.ROOT);
        return normalized.startsWith("gemini") || normalized.startsWith("google/");
    }
}
