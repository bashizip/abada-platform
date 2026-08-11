package io.abada.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.abada.worker.AbadaWorkerClient;
import io.abada.worker.AgentAttemptMetadata;
import io.abada.worker.AgentWorkDescriptor;
import io.abada.worker.LockedExternalTask;
import io.abada.worker.RequestOptions;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/** First-party worker for APL {@code agent} tasks over worker protocol v1. */
public final class AgentWorkerMain {
    private static final System.Logger LOG = System.getLogger(AgentWorkerMain.class.getName());
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final AtomicLong COMPLETED = new AtomicLong();
    private static final AtomicLong FAILED = new AtomicLong();

    private AgentWorkerMain() {}

    public static void main(String[] args) throws Exception {
        Config config = Config.fromEnvironment();
        Supplier<String> tokens = config.tokenUrl() == null
                ? () -> config.engineToken()
                : new ClientCredentialsTokenSupplier(config);
        AbadaWorkerClient engine = new AbadaWorkerClient(config.engineUrl(), tokens);
        AgentGatewayFactory gateways = new AgentGatewayFactory(config);
        LOG.log(System.Logger.Level.INFO,
                "agent_worker_started worker_id={0} topic=abada:agent", config.workerId());
        while (!Thread.currentThread().isInterrupted()) {
            try {
                List<LockedExternalTask> tasks = engine.fetchAndLock(config.projectId(), config.workerId(),
                        List.of("abada:agent"),
                        config.lockDuration(), config.maxTasks(), RequestOptions.defaults());
                for (LockedExternalTask task : tasks) process(engine, gateways, config, task);
                if (tasks.isEmpty()) Thread.sleep(config.pollInterval().toMillis());
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            } catch (Exception exception) {
                // Keep the worker alive: transient auth, binding or engine failures
                // must be retried rather than crash the sidecar.
                LOG.log(System.Logger.Level.WARNING,
                        "agent_fetch_failed message={0} retrying_in_ms={1}",
                        safeMessage(exception), config.pollInterval().toMillis());
                try {
                    Thread.sleep(config.pollInterval().toMillis());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }

    private static void process(AbadaWorkerClient engine, AgentGatewayFactory gateways,
            Config config, LockedExternalTask task) {
        AgentWorkDescriptor work = task.agentWork();
        RequestOptions options = new RequestOptions("agent-" + task.id(), task.traceParent(), null);
        int configuredAttempts = work == null || work.maxAttempts() == null ? 3 : work.maxAttempts();
        int currentRetries = task.retries() == null ? configuredAttempts : task.retries();
        int attempt = Math.max(1, configuredAttempts - Math.min(currentRetries, configuredAttempts) + 1);
        try {
            if (work == null || !"abada.agent/v1".equals(work.profileVersion())) {
                throw new IllegalArgumentException("Missing or unsupported abada.agent/v1 descriptor");
            }
            Set<String> requestedTools = work.tools() == null ? Set.of() : Set.copyOf(work.tools());
            if (!config.allowedTools().containsAll(requestedTools)) {
                throw new IllegalArgumentException("Agent requests tools outside the configured allow-list");
            }
            String model = resolveModel(config, work);
            AgentGateway gateway = gateways.gatewayFor(work);
            long startedNanos = System.nanoTime();
            AgentResult result = gateway.execute(work, task.variables());
            long durationMs = java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(
                    Math.max(0, System.nanoTime() - startedNanos));
            String resultVariable = blankToDefault(work.resultVariable(), task.activityId() + "_result");
            engine.complete(task.id(), config.workerId(), Map.of(resultVariable, result.value()),
                    new AgentAttemptMetadata(model, gateway.provider(), attempt, durationMs,
                            List.copyOf(requestedTools), resultVariable, promptHash(work.prompt()), null,
                            result.confidence()),
                    options);
            long completed = COMPLETED.incrementAndGet();
            LOG.log(System.Logger.Level.INFO,
                    "agent_task_completed task_id={0} activity_id={1} model={2} attempt={3} completed_total={4} failed_total={5}",
                    task.id(), task.activityId(), model, attempt, completed, FAILED.get());
        } catch (Exception exception) {
            int remaining = Math.max(0, Math.min(currentRetries, configuredAttempts) - 1);
            long backoff = work == null || work.retryBackoffMs() == null ? 2_000L : work.retryBackoffMs();
            String model = work == null ? config.defaultModel() : resolveModel(config, work);
            String provider = work == null ? "unknown" : gateways.gatewayFor(work).provider();
            // A below-threshold attempt is the most interesting failure: keep the
            // achieved score so operators can see exactly how far off it was.
            Double achieved = exception instanceof ConfidenceBelowThresholdException
                    ? ((ConfidenceBelowThresholdException) exception).confidence() : null;
            engine.fail(task.id(), config.workerId(), safeMessage(exception), exception.getClass().getSimpleName(),
                    remaining, Duration.ofMillis(backoff),
                    new AgentAttemptMetadata(model, provider, attempt, null, List.of(), null, null,
                            exception.getClass().getSimpleName(), achieved),
                    options);
            long failed = FAILED.incrementAndGet();
            LOG.log(System.Logger.Level.WARNING,
                    "agent_task_failed task_id={0} activity_id={1} model={2} attempt={3} retries_remaining={4} completed_total={5} failed_total={6}",
                    task.id(), task.activityId(), model, attempt, remaining, COMPLETED.get(), failed);
        }
    }

    private static String safeMessage(Exception exception) {
        String value = exception.getMessage();
        if (value == null || value.isBlank()) return "Agent execution failed";
        return value.length() > 300 ? value.substring(0, 300) : value;
    }

    private static String blankToDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    /** Stable identifier for the prompt template; never contains prompt text. */
    static String promptHash(String prompt) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((prompt == null ? "" : prompt).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest).substring(0, 16);
        } catch (java.security.NoSuchAlgorithmException exception) {
            return "";
        }
    }

    private static String resolveModel(Config config, AgentWorkDescriptor work) {
        return blankToDefault(work.model(), config.defaultModel());
    }

    record Config(URI engineUrl, String engineToken, URI tokenUrl, String oidcClientId,
            String oidcClientSecret, URI llmBaseUrl, String llmApiKey,
            URI openAiBaseUrl, String openAiApiKey,
            String defaultModel, String workerId, String projectId,
            Duration pollInterval, Duration lockDuration,
            int maxTasks, Set<String> allowedTools) {
        Config(URI engineUrl, String engineToken, URI tokenUrl, String oidcClientId,
                String oidcClientSecret, URI llmBaseUrl, String llmApiKey,
                URI openAiBaseUrl, String openAiApiKey,
                String defaultModel, String workerId, Duration pollInterval,
                Duration lockDuration, int maxTasks, Set<String> allowedTools) {
            this(engineUrl, engineToken, tokenUrl, oidcClientId, oidcClientSecret,
                    llmBaseUrl, llmApiKey, openAiBaseUrl, openAiApiKey,
                    defaultModel, workerId, "", pollInterval, lockDuration, maxTasks, allowedTools);
        }

        static Config fromEnvironment() {
            Map<String, String> env = System.getenv();
            String baseUrl = required(env, "ABADA_ENGINE_URL");
            Endpoints endpoints = resolveEndpoints(env);
            Set<String> tools = Arrays.stream(env.getOrDefault("ABADA_AGENT_ALLOWED_TOOLS", "").split(","))
                    .map(String::strip).filter(value -> !value.isBlank()).collect(Collectors.toUnmodifiableSet());
            String tokenUrl = env.getOrDefault("ABADA_AGENT_OIDC_TOKEN_URL", "");
            String clientId = env.getOrDefault("ABADA_AGENT_OIDC_CLIENT_ID", "");
            String clientSecret = env.getOrDefault("ABADA_AGENT_OIDC_CLIENT_SECRET", "");
            String staticToken = env.getOrDefault("ABADA_ENGINE_TOKEN", "");
            if (!tokenUrl.isBlank() && (clientId.isBlank() || clientSecret.isBlank())) {
                throw new IllegalArgumentException("OIDC client id and secret are required with the token URL");
            }
            return new Config(URI.create(baseUrl), staticToken,
                    tokenUrl.isBlank() ? null : URI.create(tokenUrl), clientId, clientSecret,
                    URI.create(endpoints.llmUrl()), endpoints.apiKey(),
                    URI.create(endpoints.openAiUrl()), endpoints.openAiKey(),
                    env.getOrDefault("ABADA_AGENT_LLM_MODEL", "gemini-2.5-flash"),
                    env.getOrDefault("ABADA_AGENT_WORKER_ID", "abada-agent-worker"),
                    env.getOrDefault("ABADA_AGENT_PROJECT_ID", ""),
                    Duration.ofMillis(longValue(env, "ABADA_AGENT_POLL_INTERVAL_MS", 1_000, 100, 60_000)),
                    Duration.ofMillis(longValue(env, "ABADA_AGENT_LOCK_DURATION_MS", 120_000, 1_000, 3_600_000)),
                    (int) longValue(env, "ABADA_AGENT_MAX_TASKS", 4, 1, 50), tools);
        }

        /**
         * Resolves the Gemini and OpenAI-compatible endpoints. At least one pair
         * is required; each endpoint falls back to the other so a worker can run
         * with only a Gemini or only an OpenAI-compatible provider.
         */
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

    static final class ClientCredentialsTokenSupplier implements Supplier<String> {
        private final Config config;
        private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        private String token;
        private Instant refreshAt = Instant.EPOCH;

        ClientCredentialsTokenSupplier(Config config) {
            this.config = config;
        }

        @Override
        public synchronized String get() {
            if (token != null && Instant.now().isBefore(refreshAt)) return token;
            try {
                String body = "grant_type=client_credentials&client_id=" + encode(config.oidcClientId())
                        + "&client_secret=" + encode(config.oidcClientSecret());
                HttpRequest request = HttpRequest.newBuilder(config.tokenUrl()).timeout(Duration.ofSeconds(20))
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .POST(HttpRequest.BodyPublishers.ofString(body)).build();
                HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() / 100 != 2) {
                    throw new IllegalStateException("OIDC token endpoint returned HTTP " + response.statusCode());
                }
                JsonNode json = JSON.readTree(response.body());
                token = json.path("access_token").asText();
                if (token.isBlank()) throw new IllegalStateException("OIDC response has no access token");
                long lifetime = Math.max(30, json.path("expires_in").asLong(300));
                refreshAt = Instant.now().plusSeconds(Math.max(1, lifetime - 30));
                return token;
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("OIDC token request interrupted");
            } catch (Exception exception) {
                throw new IllegalStateException("Could not obtain OIDC worker token", exception);
            }
        }

        private String encode(String value) {
            return URLEncoder.encode(value, StandardCharsets.UTF_8);
        }
    }

    /** Common contract for LLM provider gateways behind APL {@code agent} tasks. */
    interface AgentGateway {
        AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception;

        /** Stable provider family reported in attempt metadata, e.g. {@code openai-compatible}. */
        String provider();
    }

    /** Decoded agent result plus the {@code _confidence} the model reported. */
    record AgentResult(Object value, Double confidence) {}

    /**
     * Carries the achieved {@code _confidence} across the throw boundary so a
     * below-threshold attempt still reports its score in failure metadata.
     */
    static final class ConfidenceBelowThresholdException extends IllegalStateException {
        private final Double confidence;

        ConfidenceBelowThresholdException(double confidence) {
            super("Agent confidence is below the APL threshold");
            this.confidence = confidence;
        }

        Double confidence() {
            return confidence;
        }
    }

    /**
     * Renders the result under {@code resultVariable} and keeps the reported
     * {@code _confidence} so it can be persisted in attempt metadata.
     */

    /**
     * Routes a requested model name to the concrete {@link AgentGateway} that can
     * serve it. Models named {@code gemini*} or prefixed {@code google/} use the
     * Gemini gateway; everything else uses the OpenAI-compatible gateway.
     */
    static final class AgentGatewayFactory {
        private final Config config;
        private final OpenAiCompatibleGateway openAi;
        private final GoogleGeminiGateway gemini;

        AgentGatewayFactory(Config config) {
            this.config = config;
            this.openAi = new OpenAiCompatibleGateway(config);
            this.gemini = new GoogleGeminiGateway(config);
        }

        AgentGateway gatewayFor(AgentWorkDescriptor work) {
            return isGeminiModel(resolveModel(config, work)) ? gemini : openAi;
        }

        private static boolean isGeminiModel(String model) {
            String normalized = model.strip().toLowerCase(Locale.ROOT);
            return normalized.startsWith("gemini") || normalized.startsWith("google/");
        }
    }

    /** Shared prompt rendering, input selection and result decoding for LLM gateways. */
    abstract static class AbstractAgentGateway {
        protected final Config config;
        protected final HttpClient http;

        AbstractAgentGateway(Config config) {
            this.config = config;
            this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        }

        protected String renderPrompt(AgentWorkDescriptor work, Map<String, Object> variables) {
            String prompt = blankToDefault(work.prompt(), "Process the supplied workflow variables.");
            for (Map.Entry<String, Object> variable : variables.entrySet()) {
                prompt = prompt.replace("${" + variable.getKey() + "}", String.valueOf(variable.getValue()));
            }
            if (work.tools() != null && !work.tools().isEmpty()) {
                prompt += "\nAllowed tool identifiers: " + String.join(", ", work.tools())
                        + ". Return a result; do not claim an unperformed side effect.";
            }
            return prompt;
        }

        protected Map<String, Object> selectInputs(AgentWorkDescriptor work, Map<String, Object> variables) {
            if (work.inputs() == null || work.inputs().isEmpty()) return variables;
            Map<String, Object> selected = new LinkedHashMap<>();
            work.inputs().forEach((name, expression) -> {
                String key = expression == null ? name : expression.replaceAll("^\\$\\{|}$", "");
                selected.put(name, variables.get(key));
            });
            return selected;
        }

        protected AgentResult decodeResult(String content, AgentWorkDescriptor work) throws Exception {
            if (work.outputSchema() == null || work.outputSchema().isEmpty()) {
                return new AgentResult(content, null);
            }
            JsonNode parsed = JSON.readTree(stripFence(content));
            if (!parsed.isObject()) throw new IllegalStateException("Agent output must be a JSON object");
            double confidence = parsed.path("_confidence").asDouble(100.0);
            double minimum = work.confidenceThreshold() == null ? 0.0 : work.confidenceThreshold();
            if (confidence < minimum) throw new ConfidenceBelowThresholdException(confidence);
            return new AgentResult(JSON.convertValue(parsed, Map.class), confidence);
        }

        protected String stripFence(String value) {
            String stripped = value.strip();
            if (stripped.startsWith("```")) {
                stripped = stripped.replaceFirst("^```(?:json)?\\s*", "").replaceFirst("\\s*```$", "");
            }
            return stripped;
        }
    }

    /** OpenAI-compatible {@code /chat/completions} gateway for the default provider family. */
    static final class OpenAiCompatibleGateway extends AbstractAgentGateway implements AgentGateway {
        OpenAiCompatibleGateway(Config config) {
            super(config);
        }

        @Override
        public String provider() {
            return "openai-compatible";
        }

        @Override
        public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception {
            long timeoutMs = work.timeoutMs() == null ? 60_000L : work.timeoutMs();
            String model = resolveModel(config, work);
            String prompt = renderPrompt(work, variables);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", model);
            body.put("messages", List.of(Map.of("role", "system", "content", prompt),
                    Map.of("role", "user", "content", JSON.writeValueAsString(selectInputs(work, variables)))));
            body.put("temperature", work.temperature() == null ? 0.2 : work.temperature());
            body.put("max_tokens", work.maxTokens() == null ? 2048 : work.maxTokens());
            HttpRequest request = HttpRequest.newBuilder(config.openAiBaseUrl().resolve(
                            config.openAiBaseUrl().getPath().replaceAll("/+$", "") + "/chat/completions"))
                    .timeout(Duration.ofMillis(timeoutMs)).header("Authorization", "Bearer " + config.openAiApiKey())
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("LLM gateway returned HTTP " + response.statusCode());
            }
            JsonNode contentNode = JSON.readTree(response.body()).path("choices").path(0)
                    .path("message").path("content");
            if (!contentNode.isTextual() || contentNode.asText().isBlank()) {
                throw new IllegalStateException("LLM gateway returned no assistant content");
            }
            return decodeResult(contentNode.asText(), work);
        }
    }

    /** Google Gemini {@code :generateContent} gateway for {@code gemini*} and {@code google/} models. */
    static final class GoogleGeminiGateway extends AbstractAgentGateway implements AgentGateway {
        GoogleGeminiGateway(Config config) {
            super(config);
        }

        @Override
        public String provider() {
            return "google-gemini";
        }

        @Override
        public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception {
            long timeoutMs = work.timeoutMs() == null ? 60_000L : work.timeoutMs();
            String model = resolveModel(config, work).strip().replaceFirst("(?i)^google/", "");
            String prompt = renderPrompt(work, variables);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("systemInstruction", Map.of("parts", List.of(Map.of("text", prompt))));
            body.put("contents", List.of(Map.of("role", "user",
                    "parts", List.of(Map.of("text", JSON.writeValueAsString(selectInputs(work, variables)))))));
            Map<String, Object> generationConfig = new LinkedHashMap<>();
            generationConfig.put("temperature", work.temperature() == null ? 0.2 : work.temperature());
            generationConfig.put("maxOutputTokens", work.maxTokens() == null ? 2048 : work.maxTokens());
            body.put("generationConfig", generationConfig);
            HttpRequest request = HttpRequest.newBuilder(config.llmBaseUrl().resolve(
                            config.llmBaseUrl().getPath().replaceAll("/+$", "")
                                    + "/models/" + model + ":generateContent"))
                    .timeout(Duration.ofMillis(timeoutMs)).header("x-goog-api-key", config.llmApiKey())
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("Gemini gateway returned HTTP " + response.statusCode());
            }
            JsonNode contentNode = JSON.readTree(response.body()).path("candidates").path(0)
                    .path("content").path("parts").path(0).path("text");
            if (!contentNode.isTextual() || contentNode.asText().isBlank()) {
                throw new IllegalStateException("Gemini gateway returned no assistant content");
            }
            return decodeResult(contentNode.asText(), work);
        }
    }
}
