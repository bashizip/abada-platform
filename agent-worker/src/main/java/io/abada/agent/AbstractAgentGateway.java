package io.abada.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.abada.worker.AgentWorkDescriptor;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Shared prompt rendering, input selection and result decoding for LLM gateways. */
public abstract class AbstractAgentGateway implements AgentGateway {
    protected static final ObjectMapper JSON = new ObjectMapper();
    protected final WorkerConfig config;
    protected final HttpClient http;

    protected AbstractAgentGateway(WorkerConfig config) {
        this.config = config;
        this.http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(10)).build();
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

    protected AgentResult executeChatCompletion(URI targetUri, String apiKey, String model,
                                                 AgentWorkDescriptor work, Map<String, Object> variables) throws Exception {
        if (apiKey == null || apiKey.isBlank()) {
            throw new AgentConfigurationException(provider() + " API key is not configured (ABADA_AGENT_LLM_API_KEY / ABADA_LLM_API_KEY is unset or blank)");
        }
        long timeoutMs = work.timeoutMs() == null ? 60_000L : work.timeoutMs();
        String prompt = renderPrompt(work, variables);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", model);
        body.put("messages", List.of(
                Map.of("role", "system", "content", prompt),
                Map.of("role", "user", "content", JSON.writeValueAsString(selectInputs(work, variables)))
        ));
        body.put("temperature", work.temperature() == null ? 0.2 : work.temperature());
        body.put("max_tokens", work.maxTokens() == null ? 2048 : work.maxTokens());

        HttpRequest request = HttpRequest.newBuilder(targetUri)
                .timeout(Duration.ofMillis(timeoutMs))
                .header("Authorization", "Bearer " + apiKey)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)))
                .build();

        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (Exception networkException) {
            String host = targetUri.getHost() == null ? targetUri.toString() : targetUri.getHost();
            throw new AgentUnreachableException(provider() + " API is unreachable at " + host + " (" + networkException.getMessage() + ")", networkException);
        }

        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            String detail = extractErrorDetail(response.body());
            int status = response.statusCode();
            if (status == 401 || status == 403) {
                throw new AgentAuthenticationException(provider() + " API authentication failed: Invalid or expired API key (HTTP " + status + (detail.isBlank() ? "" : ": " + detail) + ")");
            } else if (status == 404) {
                throw new AgentModelNotFoundException(provider() + " model or endpoint not found: '" + model + "' (HTTP 404" + (detail.isBlank() ? "" : ": " + detail) + ")");
            } else if (status == 429) {
                throw new AgentQuotaExceededException(provider() + " quota or rate limit exceeded (HTTP 429" + (detail.isBlank() ? "" : ": " + detail) + ")");
            } else {
                throw new AgentExecutionException(provider() + " API returned error (HTTP " + status + (detail.isBlank() ? "" : ": " + detail) + ")");
            }
        }

        JsonNode contentNode = JSON.readTree(response.body()).path("choices").path(0)
                .path("message").path("content");
        if (!contentNode.isTextual() || contentNode.asText().isBlank()) {
            throw new AgentExecutionException(provider() + " gateway returned no assistant content");
        }
        return decodeResult(contentNode.asText(), work);
    }

    private static String extractErrorDetail(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) return "";
        try {
            JsonNode tree = JSON.readTree(responseBody);
            JsonNode errorNode = tree.path("error");
            if (!errorNode.isMissingNode()) {
                String message = errorNode.path("message").asText("");
                String status = errorNode.path("status").asText("");
                if (!message.isBlank() && !status.isBlank()) return status + " - " + message;
                if (!message.isBlank()) return message;
                if (!status.isBlank()) return status;
                return errorNode.toString();
            }
        } catch (Exception ignored) {
            // fallback to raw truncated response body
        }
        String stripped = responseBody.strip().replaceAll("\\s+", " ");
        return stripped.length() > 200 ? stripped.substring(0, 200) + "…" : stripped;
    }

    protected AgentResult decodeResult(String content, AgentWorkDescriptor work) throws Exception {
        if (work.outputSchema() == null || work.outputSchema().isEmpty()) {
            return new AgentResult(content, null);
        }
        String stripped = stripFence(content);
        JsonNode parsed;
        try {
            parsed = JSON.readTree(stripped);
        } catch (Exception parseException) {
            throw new AgentExecutionException("Agent output is not valid JSON (" + parseException.getMessage() + "): " + content);
        }
        if (!parsed.isObject()) throw new AgentExecutionException("Agent output must be a JSON object, received: " + content);
        double confidence = parsed.path("_confidence").asDouble(100.0);
        double minimum = work.confidenceThreshold() == null ? 0.0 : work.confidenceThreshold();
        if (confidence < minimum) throw new ConfidenceBelowThresholdException(confidence);
        return new AgentResult(JSON.convertValue(parsed, Map.class), confidence);
    }

    protected String stripFence(String value) {
        if (value == null || value.isBlank()) return "";
        String content = value.strip();
        int fence = content.indexOf("```");
        if (fence >= 0) {
            int start = content.indexOf('\n', fence);
            int end = start < 0 ? -1 : content.indexOf("```", start + 1);
            if (start >= 0 && end > start) {
                content = content.substring(start + 1, end);
            } else if (content.startsWith("```")) {
                content = content.replaceFirst("^```(?:json)?\\s*", "").replaceFirst("\\s*```$", "");
            }
        }
        return content.strip();
    }

    protected static String blankToDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }
}
