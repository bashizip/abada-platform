package io.abada.agent;

import java.net.URI;
import java.time.Duration;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

public record WorkerConfig(
        URI engineUrl,
        String engineToken,
        URI tokenUrl,
        String oidcClientId,
        String oidcClientSecret,
        URI llmBaseUrl,
        String llmApiKey,
        URI openAiBaseUrl,
        String openAiApiKey,
        String defaultModel,
        String workerId,
        Set<String> allowedModels,
        Duration pollInterval,
        Duration lockDuration,
        int maxTasks,
        Set<String> allowedTools) {

    public WorkerConfig(
            URI engineUrl, String engineToken, URI tokenUrl, String oidcClientId,
            String oidcClientSecret, URI llmBaseUrl, String llmApiKey,
            URI openAiBaseUrl, String openAiApiKey,
            String defaultModel, String workerId, Duration pollInterval,
            Duration lockDuration, int maxTasks, Set<String> allowedTools) {
        this(engineUrl, engineToken, tokenUrl, oidcClientId, oidcClientSecret,
                llmBaseUrl, llmApiKey, openAiBaseUrl, openAiApiKey,
                defaultModel, workerId, Set.of(), pollInterval, lockDuration, maxTasks, allowedTools);
    }

    public static WorkerConfig fromEnvironment() {
        Map<String, String> env = System.getenv();
        String baseUrl = required(env, "ABADA_ENGINE_URL");
        Endpoints endpoints = resolveEndpoints(env);
        Set<String> tools = Arrays.stream(env.getOrDefault("ABADA_AGENT_ALLOWED_TOOLS", "").split(","))
                .map(String::strip).filter(value -> !value.isBlank()).collect(Collectors.toUnmodifiableSet());
        Set<String> models = Arrays.stream(env.getOrDefault("ABADA_AGENT_MODELS", "").split(","))
                .map(String::strip).filter(value -> !value.isBlank()).collect(Collectors.toUnmodifiableSet());
        String tokenUrl = env.getOrDefault("ABADA_AGENT_OIDC_TOKEN_URL", "");
        String clientId = env.getOrDefault("ABADA_AGENT_OIDC_CLIENT_ID", "");
        String clientSecret = env.getOrDefault("ABADA_AGENT_OIDC_CLIENT_SECRET", "");
        String staticToken = env.getOrDefault("ABADA_ENGINE_TOKEN", "");
        if (!tokenUrl.isBlank() && (clientId.isBlank() || clientSecret.isBlank())) {
            throw new IllegalArgumentException("OIDC client id and secret are required with the token URL");
        }
        return new WorkerConfig(
                URI.create(baseUrl),
                staticToken,
                tokenUrl.isBlank() ? null : URI.create(tokenUrl),
                clientId,
                clientSecret,
                URI.create(endpoints.llmUrl()),
                endpoints.apiKey(),
                URI.create(endpoints.openAiUrl()),
                endpoints.openAiKey(),
                env.getOrDefault("ABADA_AGENT_LLM_MODEL", "gemini-3.6-flash"),
                env.getOrDefault("ABADA_AGENT_WORKER_ID", "abada-agent-worker"),
                models,
                Duration.ofMillis(longValue(env, "ABADA_AGENT_POLL_INTERVAL_MS", 1_000, 100, 60_000)),
                Duration.ofMillis(longValue(env, "ABADA_AGENT_LOCK_DURATION_MS", 120_000, 1_000, 3_600_000)),
                (int) longValue(env, "ABADA_AGENT_MAX_TASKS", 4, 1, 50),
                tools
        );
    }

    static Endpoints resolveEndpoints(Map<String, String> env) {
        String llmUrl = env.getOrDefault("ABADA_AGENT_LLM_BASE_URL", "").replaceAll("/+$", "");
        String apiKey = env.getOrDefault("ABADA_AGENT_LLM_API_KEY", "").strip();
        String openAiUrl = env.getOrDefault("ABADA_AGENT_OPENAI_BASE_URL", "").replaceAll("/+$", "");
        String openAiKey = env.getOrDefault("ABADA_AGENT_OPENAI_API_KEY", "").strip();
        if (llmUrl.isBlank() && openAiUrl.isBlank()) {
            throw new IllegalArgumentException(
                    "ABADA_AGENT_LLM_BASE_URL or ABADA_AGENT_OPENAI_BASE_URL is required");
        }
        if (llmUrl.isBlank()) { llmUrl = openAiUrl; apiKey = openAiKey; }
        if (openAiUrl.isBlank()) { openAiUrl = llmUrl; openAiKey = apiKey; }
        return new Endpoints(llmUrl, apiKey, openAiUrl, openAiKey);
    }

    record Endpoints(String llmUrl, String apiKey, String openAiUrl, String openAiKey) {}

    private static String required(Map<String, String> env, String key) {
        String value = env.get(key);
        if (value == null || value.isBlank()) throw new IllegalArgumentException(key + " is required");
        return value;
    }

    private static long longValue(Map<String, String> env, String key, long fallback, long min, long max) {
        long value = Long.parseLong(env.getOrDefault(key, Long.toString(fallback)));
        if (value < min || value > max) throw new IllegalArgumentException(key + " is outside supported bounds");
        return value;
    }
}
