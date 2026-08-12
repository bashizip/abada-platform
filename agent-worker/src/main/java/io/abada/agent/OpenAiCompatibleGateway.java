package io.abada.agent;

import io.abada.worker.AgentWorkDescriptor;
import java.net.URI;
import java.util.Map;

/** OpenAI-compatible {@code /chat/completions} gateway for the default provider family. */
public final class OpenAiCompatibleGateway extends AbstractAgentGateway {

    public OpenAiCompatibleGateway(WorkerConfig config) {
        super(config);
    }

    @Override
    public String provider() {
        return "openai-compatible";
    }

    @Override
    public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception {
        String model = blankToDefault(work.model(), config.defaultModel());
        URI targetUri = config.openAiBaseUrl().resolve(
                config.openAiBaseUrl().getPath().replaceAll("/+$", "") + "/chat/completions");
        return executeChatCompletion(targetUri, config.openAiApiKey(), model, work, variables);
    }
}
