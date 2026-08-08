package io.abada.worker;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

public final class AbadaWorkerClient {
    public static final String PROTOCOL_VERSION = "1";
    private final URI apiBase;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final Supplier<String> bearerToken;

    public AbadaWorkerClient(URI engineBaseUri, Supplier<String> bearerToken) {
        this(engineBaseUri, bearerToken, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(),
                JsonMapper.builder().addModule(new JavaTimeModule()).build());
    }

    AbadaWorkerClient(URI engineBaseUri, Supplier<String> bearerToken, HttpClient httpClient,
            ObjectMapper objectMapper) {
        String base = engineBaseUri.toString().replaceAll("/+$", "");
        this.apiBase = URI.create(base + "/v1/external-tasks");
        this.bearerToken = bearerToken;
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
    }

    public List<LockedExternalTask> fetchAndLock(String workerId, List<String> topics, Duration lockDuration,
            int maxTasks, RequestOptions options) {
        return fetchAndLock(null, workerId, topics, lockDuration, maxTasks, options);
    }

    public List<LockedExternalTask> fetchAndLock(String projectId, String workerId, List<String> topics,
            Duration lockDuration, int maxTasks, RequestOptions options) {
        java.util.LinkedHashMap<String, Object> body = new java.util.LinkedHashMap<>();
        if (projectId != null && !projectId.isBlank()) body.put("projectId", projectId);
        body.put("workerId", workerId);
        body.put("topics", topics);
        body.put("lockDuration", lockDuration.toMillis());
        body.put("maxTasks", maxTasks);
        HttpResponse<String> response = send("/fetch-and-lock",
                body, options);
        String protocol = response.headers().firstValue("X-Abada-Worker-Protocol-Version").orElse(null);
        if (!PROTOCOL_VERSION.equals(protocol)) {
            throw new WorkerProtocolException(response.statusCode(), "UNSUPPORTED_PROTOCOL_VERSION",
                    "Engine did not confirm worker protocol version " + PROTOCOL_VERSION);
        }
        try {
            return objectMapper.readValue(response.body(), new TypeReference<>() {});
        } catch (IOException exception) {
            throw new WorkerProtocolException(response.statusCode(), "INVALID_RESPONSE",
                    "Could not decode fetch-and-lock response");
        }
    }

    public void complete(String taskId, String workerId, Map<String, Object> variables, RequestOptions options) {
        send("/" + segment(taskId) + "/complete",
                Map.of("workerId", workerId, "variables", variables == null ? Map.of() : variables), options);
    }

    public void heartbeat(String taskId, String workerId, Duration lockDuration, RequestOptions options) {
        send("/" + segment(taskId) + "/heartbeat",
                Map.of("workerId", workerId, "lockDuration", lockDuration.toMillis()), options);
    }

    public void extendLock(String taskId, String workerId, Duration lockDuration, RequestOptions options) {
        send("/" + segment(taskId) + "/extend-lock",
                Map.of("workerId", workerId, "lockDuration", lockDuration.toMillis()), options);
    }

    public void fail(String taskId, String workerId, String message, String details, Integer retries,
            Duration retryTimeout, RequestOptions options) {
        java.util.LinkedHashMap<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("workerId", workerId);
        body.put("errorMessage", message);
        body.put("errorDetails", details);
        body.put("retries", retries);
        body.put("retryTimeout", retryTimeout == null ? null : retryTimeout.toMillis());
        send("/" + segment(taskId) + "/failure", body, options);
    }

    public void bpmnError(String taskId, String workerId, String errorCode, String errorMessage,
            Map<String, Object> variables, RequestOptions options) {
        send("/" + segment(taskId) + "/bpmn-error",
                Map.of("workerId", workerId, "errorCode", errorCode,
                        "errorMessage", errorMessage == null ? "" : errorMessage,
                        "variables", variables == null ? Map.of() : variables), options);
    }

    private HttpResponse<String> send(String path, Object body, RequestOptions suppliedOptions) {
        RequestOptions options = suppliedOptions == null ? RequestOptions.defaults() : suppliedOptions;
        try {
            HttpRequest.Builder request = HttpRequest.newBuilder(apiBase.resolve(apiBase.getPath() + path))
                    .timeout(Duration.ofSeconds(30)).header("Content-Type", "application/json")
                    .header("Accept", "application/json").header("X-Abada-Worker-Protocol-Version", PROTOCOL_VERSION)
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)));
            String token = bearerToken == null ? null : bearerToken.get();
            if (token != null && !token.isBlank()) request.header("Authorization", "Bearer " + token);
            if (options.idempotencyKey() != null) request.header("Idempotency-Key", options.idempotencyKey());
            if (options.traceParent() != null) request.header("traceparent", options.traceParent());
            if (options.traceState() != null) request.header("tracestate", options.traceState());
            HttpResponse<String> response = httpClient.send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) throw protocolError(response);
            return response;
        } catch (WorkerProtocolException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new WorkerProtocolException(0, "NETWORK_ERROR", exception.getMessage());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new WorkerProtocolException(0, "INTERRUPTED", "Worker request was interrupted");
        }
    }

    private WorkerProtocolException protocolError(HttpResponse<String> response) {
        try {
            JsonNode error = objectMapper.readTree(response.body());
            return new WorkerProtocolException(response.statusCode(), error.path("code").asText("HTTP_ERROR"),
                    error.path("message").asText("Engine rejected worker request"));
        } catch (Exception ignored) {
            return new WorkerProtocolException(response.statusCode(), "HTTP_ERROR", "Engine rejected worker request");
        }
    }

    private String segment(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8).replace("+", "%20");
    }
}
