package io.abada.agent;

import java.net.URI;
import java.time.Duration;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
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
        Set<String> allowedTools,
        Set<String> localAckTopics,
        Duration maxTimeout,
        StructuredOutput structuredOutput) {

    /**
     * How the worker asks OpenAI-compatible providers for structured output when a
     * node declares {@code output_schema} ({@code ABADA_AGENT_STRUCTURED_OUTPUT}).
     * The engine validates the result either way.
     */
    public enum StructuredOutput {
        /** No {@code response_format}; rely on the prompt instruction only. */
        OFF,
        /** {@code {"type":"json_object"}}: widely supported JSON mode (default). */
        JSON_OBJECT,
        /** {@code {"type":"json_schema", ...}} with the node schema, for providers that support it. */
        JSON_SCHEMA;

        public Object responseFormat(java.util.Map<String, Object> schema) {
            return switch (this) {
                case OFF -> null;
                case JSON_OBJECT -> java.util.Map.of("type", "json_object");
                case JSON_SCHEMA -> java.util.Map.of("type", "json_schema", "json_schema",
                        java.util.Map.of("name", "agent_output", "schema", schema));
            };
        }

        static StructuredOutput parse(String value) {
            if (value == null || value.isBlank()) return JSON_OBJECT;
            return switch (value.strip().toLowerCase(java.util.Locale.ROOT)) {
                case "off", "none", "false" -> OFF;
                case "json_object", "json" -> JSON_OBJECT;
                case "json_schema", "schema" -> JSON_SCHEMA;
                default -> throw new IllegalArgumentException(
                        "ABADA_AGENT_STRUCTURED_OUTPUT must be off, json_object or json_schema");
            };
        }
    }

    /** Upper bound applied to any descriptor {@code timeout_ms}. */
    public static final Duration DEFAULT_MAX_TIMEOUT = Duration.ofMinutes(2);

    public WorkerConfig(
            URI engineUrl, String engineToken, URI tokenUrl, String oidcClientId,
            String oidcClientSecret, URI llmBaseUrl, String llmApiKey,
            URI openAiBaseUrl, String openAiApiKey,
            String defaultModel, String workerId, Duration pollInterval,
            Duration lockDuration, int maxTasks, Set<String> allowedTools) {
        this(engineUrl, engineToken, tokenUrl, oidcClientId, oidcClientSecret,
                llmBaseUrl, llmApiKey, openAiBaseUrl, openAiApiKey,
                defaultModel, workerId, Set.of(), pollInterval, lockDuration, maxTasks, allowedTools, Set.of(),
                DEFAULT_MAX_TIMEOUT, StructuredOutput.JSON_OBJECT);
    }

    public static WorkerConfig fromEnvironment() {
        Map<String, String> env = System.getenv();
        String baseUrl = required(env, "ABADA_ENGINE_URL");
        Endpoints endpoints = resolveEndpoints(env);
        Set<String> tools = Arrays.stream(env.getOrDefault("ABADA_AGENT_ALLOWED_TOOLS", "").split(","))
                .map(String::strip).filter(value -> !value.isBlank()).collect(Collectors.toUnmodifiableSet());
        Set<String> models = Arrays.stream(env.getOrDefault("ABADA_AGENT_MODELS", "").split(","))
                .map(String::strip).filter(value -> !value.isBlank()).collect(Collectors.toUnmodifiableSet());
        Set<String> localAckTopics = parseLocalAckTopics(env);
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
                workerId(env),
                models,
                Duration.ofMillis(longValue(env, "ABADA_AGENT_POLL_INTERVAL_MS", 1_000, 100, 60_000)),
                Duration.ofMillis(longValue(env, "ABADA_AGENT_LOCK_DURATION_MS", 120_000, 1_000, 3_600_000)),
                (int) longValue(env, "ABADA_AGENT_MAX_TASKS", 4, 1, 50),
                tools,
                localAckTopics,
                Duration.ofMillis(longValue(env, "ABADA_AGENT_MAX_TIMEOUT_MS", DEFAULT_MAX_TIMEOUT.toMillis(),
                        1_000, 3_600_000)),
                StructuredOutput.parse(env.get("ABADA_AGENT_STRUCTURED_OUTPUT"))
        );
    }

    /**
     * Lock-owner identity sent with every fetch, completion and heartbeat.
     * Each replica needs its own, or the engine cannot tell which replica
     * holds a lock; the default adds the container hostname.
     */
    static String workerId(Map<String, String> env) {
        String configured = env.getOrDefault("ABADA_AGENT_WORKER_ID", "").strip();
        if (!configured.isEmpty()) return configured;
        String host = env.getOrDefault("HOSTNAME", "").strip();
        return "abada-agent-worker-" + (host.isEmpty() ? UUID.randomUUID().toString().substring(0, 8) : host);
    }

    static Set<String> parseLocalAckTopics(Map<String, String> env) {
        Set<String> topics = Arrays.stream(env.getOrDefault("ABADA_AGENT_LOCAL_ACK_TOPICS", "").split(","))
                .map(String::strip)
                .filter(value -> !value.isBlank())
                .collect(Collectors.toUnmodifiableSet());
        if (topics.contains("abada:agent")) {
            throw new IllegalArgumentException("ABADA_AGENT_LOCAL_ACK_TOPICS must not include abada:agent");
        }
        return topics;
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
