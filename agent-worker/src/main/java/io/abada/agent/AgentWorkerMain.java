package io.abada.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.abada.worker.AbadaWorkerClient;
import io.abada.worker.AgentWorkDescriptor;
import io.abada.worker.LockedExternalTask;
import io.abada.worker.RequestOptions;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
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
        OpenAiCompatibleGateway gateway = new OpenAiCompatibleGateway(config);
        LOG.log(System.Logger.Level.INFO,
                "agent_worker_started worker_id={0} topic=abada:agent", config.workerId());
        while (!Thread.currentThread().isInterrupted()) {
            List<LockedExternalTask> tasks = engine.fetchAndLock(config.projectId(), config.workerId(),
                    List.of("abada:agent"),
                    config.lockDuration(), config.maxTasks(), RequestOptions.defaults());
            for (LockedExternalTask task : tasks) process(engine, gateway, config, task);
            if (tasks.isEmpty()) Thread.sleep(config.pollInterval().toMillis());
        }
    }

    private static void process(AbadaWorkerClient engine, OpenAiCompatibleGateway gateway,
            Config config, LockedExternalTask task) {
        AgentWorkDescriptor work = task.agentWork();
        RequestOptions options = new RequestOptions("agent-" + task.id(), task.traceParent(), null);
        try {
            if (work == null || !"abada.agent/v1".equals(work.profileVersion())) {
                throw new IllegalArgumentException("Missing or unsupported abada.agent/v1 descriptor");
            }
            Set<String> requestedTools = work.tools() == null ? Set.of() : Set.copyOf(work.tools());
            if (!config.allowedTools().containsAll(requestedTools)) {
                throw new IllegalArgumentException("Agent requests tools outside the configured allow-list");
            }
            Object result = gateway.execute(work, task.variables());
            String resultVariable = blankToDefault(work.resultVariable(), task.activityId() + "_result");
            engine.complete(task.id(), config.workerId(), Map.of(resultVariable, result), options);
            long completed = COMPLETED.incrementAndGet();
            LOG.log(System.Logger.Level.INFO,
                    "agent_task_completed task_id={0} activity_id={1} completed_total={2} failed_total={3}",
                    task.id(), task.activityId(), completed, FAILED.get());
        } catch (Exception exception) {
            int configuredAttempts = work == null || work.maxAttempts() == null ? 3 : work.maxAttempts();
            int currentRetries = task.retries() == null ? configuredAttempts : task.retries();
            int remaining = Math.max(0, Math.min(currentRetries, configuredAttempts) - 1);
            long backoff = work == null || work.retryBackoffMs() == null ? 2_000L : work.retryBackoffMs();
            engine.fail(task.id(), config.workerId(), safeMessage(exception), exception.getClass().getSimpleName(),
                    remaining, Duration.ofMillis(backoff), options);
            long failed = FAILED.incrementAndGet();
            LOG.log(System.Logger.Level.WARNING,
                    "agent_task_failed task_id={0} activity_id={1} retries_remaining={2} completed_total={3} failed_total={4}",
                    task.id(), task.activityId(), remaining, COMPLETED.get(), failed);
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

    record Config(URI engineUrl, String engineToken, URI tokenUrl, String oidcClientId,
            String oidcClientSecret, URI llmBaseUrl, String llmApiKey,
            String defaultModel, String workerId, String projectId,
            Duration pollInterval, Duration lockDuration,
            int maxTasks, Set<String> allowedTools) {
        Config(URI engineUrl, String engineToken, URI tokenUrl, String oidcClientId,
                String oidcClientSecret, URI llmBaseUrl, String llmApiKey,
                String defaultModel, String workerId, Duration pollInterval,
                Duration lockDuration, int maxTasks, Set<String> allowedTools) {
            this(engineUrl, engineToken, tokenUrl, oidcClientId, oidcClientSecret,
                    llmBaseUrl, llmApiKey, defaultModel, workerId, "", pollInterval,
                    lockDuration, maxTasks, allowedTools);
        }

        static Config fromEnvironment() {
            Map<String, String> env = System.getenv();
            String baseUrl = required(env, "ABADA_ENGINE_URL");
            String llmUrl = required(env, "ABADA_AGENT_LLM_BASE_URL").replaceAll("/+$", "");
            String apiKey = required(env, "ABADA_AGENT_LLM_API_KEY");
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
                    URI.create(llmUrl), apiKey, env.getOrDefault("ABADA_AGENT_LLM_MODEL", "gpt-5-mini"),
                    env.getOrDefault("ABADA_AGENT_WORKER_ID", "abada-agent-worker"),
                    env.getOrDefault("ABADA_AGENT_PROJECT_ID", ""),
                    Duration.ofMillis(longValue(env, "ABADA_AGENT_POLL_INTERVAL_MS", 1_000, 100, 60_000)),
                    Duration.ofMillis(longValue(env, "ABADA_AGENT_LOCK_DURATION_MS", 120_000, 1_000, 3_600_000)),
                    (int) longValue(env, "ABADA_AGENT_MAX_TASKS", 4, 1, 50), tools);
        }

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

    static final class OpenAiCompatibleGateway {
        private final Config config;
        private final HttpClient http;

        OpenAiCompatibleGateway(Config config) {
            this.config = config;
            this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        }

        Object execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception {
            long timeoutMs = work.timeoutMs() == null ? 60_000L : work.timeoutMs();
            String model = blankToDefault(work.model(), config.defaultModel());
            String prompt = renderPrompt(work, variables);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", model);
            body.put("messages", List.of(Map.of("role", "system", "content", prompt),
                    Map.of("role", "user", "content", JSON.writeValueAsString(selectInputs(work, variables)))));
            body.put("temperature", work.temperature() == null ? 0.2 : work.temperature());
            body.put("max_tokens", work.maxTokens() == null ? 2048 : work.maxTokens());
            HttpRequest request = HttpRequest.newBuilder(config.llmBaseUrl().resolve(
                            config.llmBaseUrl().getPath().replaceAll("/+$", "") + "/chat/completions"))
                    .timeout(Duration.ofMillis(timeoutMs)).header("Authorization", "Bearer " + config.llmApiKey())
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

        private String renderPrompt(AgentWorkDescriptor work, Map<String, Object> variables) {
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

        private Map<String, Object> selectInputs(AgentWorkDescriptor work, Map<String, Object> variables) {
            if (work.inputs() == null || work.inputs().isEmpty()) return variables;
            Map<String, Object> selected = new LinkedHashMap<>();
            work.inputs().forEach((name, expression) -> {
                String key = expression == null ? name : expression.replaceAll("^\\$\\{|}$", "");
                selected.put(name, variables.get(key));
            });
            return selected;
        }

        private Object decodeResult(String content, AgentWorkDescriptor work) throws Exception {
            if (work.outputSchema() == null || work.outputSchema().isEmpty()) return content;
            JsonNode parsed = JSON.readTree(stripFence(content));
            if (!parsed.isObject()) throw new IllegalStateException("Agent output must be a JSON object");
            double confidence = parsed.path("_confidence").asDouble(100.0);
            double minimum = work.confidenceThreshold() == null ? 0.0 : work.confidenceThreshold();
            if (confidence < minimum) throw new IllegalStateException("Agent confidence is below the APL threshold");
            return JSON.convertValue(parsed, Map.class);
        }

        private String stripFence(String value) {
            String stripped = value.strip();
            if (stripped.startsWith("```")) {
                stripped = stripped.replaceFirst("^```(?:json)?\\s*", "").replaceFirst("\\s*```$", "");
            }
            return stripped;
        }
    }
}
