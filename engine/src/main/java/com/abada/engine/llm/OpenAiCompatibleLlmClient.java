package com.abada.engine.llm;

import com.abada.engine.insight.InsightProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Shared server-side gateway for OpenAI-compatible chat completions. */
@Component
public class OpenAiCompatibleLlmClient {
    private final InsightProperties properties;
    private final LlmKeyResolver keyResolver;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public OpenAiCompatibleLlmClient(InsightProperties properties, LlmKeyResolver keyResolver,
                                     ObjectMapper objectMapper) {
        this.properties = properties;
        this.keyResolver = keyResolver;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder().connectTimeout(properties.getLlmTimeout()).build();
    }

    public boolean isConfigured() { return keyResolver.isConfigured(); }
    public String model() { return keyResolver.resolveModel(); }

    public String complete(String systemPrompt, String userPrompt) throws Exception {
        String apiKey = keyResolver.resolveKey();
        String baseUrl = keyResolver.resolveBaseUrl();
        String model = keyResolver.resolveModel();
        if (apiKey == null || apiKey.isBlank()) throw new IllegalStateException("LLM provider is not configured");
        if (baseUrl == null || baseUrl.isBlank()) throw new IllegalStateException("LLM base URL is not configured");
        Map<String, Object> payload = Map.of(
                "model", model,
                "temperature", 0.2,
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user", "content", userPrompt)));
        HttpRequest.Builder request = HttpRequest.newBuilder(
                        URI.create(stripTrailingSlash(baseUrl) + "/chat/completions"))
                .timeout(properties.getLlmTimeout())
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey);
        if (properties.isOpenRouterEnabled()) {
            request.header("HTTP-Referer", properties.getOpenRouterReferer());
            request.header("X-Title", properties.getOpenRouterTitle());
        }
        HttpResponse<String> response = httpClient.send(request.POST(HttpRequest.BodyPublishers.ofString(
                        objectMapper.writeValueAsString(payload), StandardCharsets.UTF_8)).build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() / 100 != 2) {
            String detail = extractErrorDetail(response.body());
            int status = response.statusCode();
            if (status == 401 || status == 403) {
                throw new IllegalStateException("LLM API authentication failed: Invalid or expired API key (HTTP " + status + (detail.isBlank() ? "" : ": " + detail) + ")");
            } else if (status == 404) {
                throw new IllegalStateException("LLM model or endpoint not found: '" + model + "' (HTTP 404" + (detail.isBlank() ? "" : ": " + detail) + ")");
            } else if (status == 429) {
                throw new IllegalStateException("LLM quota or rate limit exceeded (HTTP 429" + (detail.isBlank() ? "" : ": " + detail) + ")");
            }
            throw new IllegalStateException("LLM endpoint returned HTTP " + response.statusCode() + (detail.isBlank() ? "" : ": " + detail));
        }
        JsonNode content = objectMapper.readTree(response.body()).path("choices").path(0)
                .path("message").path("content");
        if (!content.isTextual() || content.asText().isBlank()) {
            throw new IllegalStateException("LLM response contained no usable text");
        }
        return extractDocument(content.asText());
    }

    private String extractErrorDetail(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) return "";
        try {
            JsonNode tree = objectMapper.readTree(responseBody);
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
            // fallback
        }
        String stripped = responseBody.strip().replaceAll("\\s+", " ");
        return stripped.length() > 200 ? stripped.substring(0, 200) + "…" : stripped;
    }

    public static String extractDocument(String completion) {
        if (completion == null || completion.isBlank()) return null;
        String content = completion.strip();
        int fence = content.indexOf("```");
        if (fence >= 0) {
            int start = content.indexOf('\n', fence);
            int end = start < 0 ? -1 : content.indexOf("```", start + 1);
            if (start >= 0 && end > start) content = content.substring(start + 1, end);
        }
        return content.strip();
    }

    private static String stripTrailingSlash(String url) {
        String result = url;
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }
}
