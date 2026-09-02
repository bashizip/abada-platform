package com.abada.engine.api;

import com.abada.engine.insight.InsightProperties;
import com.abada.engine.llm.LlmKeyResolver;
import com.abada.engine.llm.OpenAiCompatibleLlmClient;
import com.abada.engine.persistence.entity.AiProviderSettingsEntity;
import com.abada.engine.persistence.repository.AiProviderSettingsRepository;
import com.abada.engine.security.AesEncryption;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Insight engine and AI provider configuration for Studio settings display
 * and live connection tests. The API key is never exposed in responses.
 */
@RestController
@RequestMapping("/v1/insight/config")
public class InsightConfigController {

    private final InsightProperties properties;
    private final OpenAiCompatibleLlmClient llmClient;
    private final AiProviderSettingsRepository settingsRepository;
    private final AesEncryption encryption;
    private final LlmKeyResolver keyResolver;

    public InsightConfigController(InsightProperties properties, OpenAiCompatibleLlmClient llmClient,
                                   AiProviderSettingsRepository settingsRepository,
                                   AesEncryption encryption, LlmKeyResolver keyResolver) {
        this.properties = properties;
        this.llmClient = llmClient;
        this.settingsRepository = settingsRepository;
        this.encryption = encryption;
        this.keyResolver = keyResolver;
    }

    // ── Legacy LLM endpoints (env-var driven, kept for backward compatibility) ──

    @PostMapping("/llm/test")
    public ResponseEntity<Map<String, Object>> testLlmConnection() {
        if (!properties.isLlmConfigured()) {
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "status", "NOT_CONFIGURED",
                    "message", "LLM API key is not configured (ABADA_LLM_API_KEY is unset or blank)"
            ));
        }
        long start = System.currentTimeMillis();
        try {
            String result = llmClient.complete("You are a system liveness probe.", "Reply with READY");
            long latencyMs = System.currentTimeMillis() - start;
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "status", "READY",
                    "latencyMs", latencyMs,
                    "model", properties.getLlmModel(),
                    "message", "LLM API connection successful"
            ));
        } catch (Exception e) {
            long latencyMs = System.currentTimeMillis() - start;
            String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "status", "ERROR",
                    "latencyMs", latencyMs,
                    "model", properties.getLlmModel(),
                    "message", msg
            ));
        }
    }

    @GetMapping("/llm")
    public ResponseEntity<Map<String, Object>> getLlmConfig() {
        return ResponseEntity.ok(Map.of(
                "enabled", properties.isEnabled(),
                "configured", properties.isLlmConfigured(),
                "providerType", properties.getLlmProviderType(),
                "baseUrl", maskUrl(keyResolver.resolveBaseUrl()),
                "model", keyResolver.resolveModel(),
                "openRouterEnabled", properties.isOpenRouterEnabled(),
                "openRouterReferer", properties.getOpenRouterReferer(),
                "openRouterTitle", properties.getOpenRouterTitle()
        ));
    }

    // ── AI Provider Settings (database-backed, GUI-configurable) ──

    /**
     * Returns the saved AI provider settings. The API key is never returned;
     * only a masked hint is included.
     */
    @GetMapping("/ai")
    public ResponseEntity<Map<String, Object>> getAiSettings() {
        Optional<AiProviderSettingsEntity> existing = settingsRepository.findById("default");
        if (existing.isEmpty()) {
            return ResponseEntity.ok(Map.of(
                    "configured", false,
                    "providerType", "openai-compatible",
                    "baseUrl", "",
                    "model", "",
                    "apiKeyHint", "",
                    "enabled", false
            ));
        }
        AiProviderSettingsEntity s = existing.get();
        boolean hasKey = s.getApiKeyEnc() != null && !s.getApiKeyEnc().isBlank();
        return ResponseEntity.ok(Map.of(
                "configured", hasKey && s.isEnabled(),
                "providerType", s.getProviderType(),
                "baseUrl", s.getBaseUrl() != null ? s.getBaseUrl() : "",
                "model", s.getModel() != null ? s.getModel() : "",
                "apiKeyHint", hasKey ? encryption.hint(s.getApiKeyEnc()) : "",
                "enabled", s.isEnabled()
        ));
    }

    /**
     * Saves AI provider settings. The API key is encrypted before persisting.
     * If {@code apiKey} is null or blank, the existing encrypted key is preserved.
     */
    @PutMapping("/ai")
    public ResponseEntity<Map<String, Object>> saveAiSettings(@RequestBody Map<String, Object> body) {
        AiProviderSettingsEntity entity = settingsRepository.findById("default")
                .orElseGet(() -> {
                    AiProviderSettingsEntity e = new AiProviderSettingsEntity();
                    e.setId("default");
                    e.setCreatedAt(Instant.now());
                    return e;
                });

        if (body.containsKey("providerType")) {
            entity.setProviderType((String) body.get("providerType"));
        }
        if (body.containsKey("baseUrl")) {
            entity.setBaseUrl((String) body.get("baseUrl"));
        }
        if (body.containsKey("model")) {
            entity.setModel((String) body.get("model"));
        }
        if (body.containsKey("enabled")) {
            entity.setEnabled(Boolean.TRUE.equals(body.get("enabled")));
        }
        if (body.containsKey("timeoutMs")) {
            entity.setTimeoutMs(((Number) body.get("timeoutMs")).longValue());
        }

        String apiKey = body.containsKey("apiKey") ? (String) body.get("apiKey") : null;
        if (apiKey != null && !apiKey.isBlank()) {
            entity.setApiKeyEnc(encryption.encrypt(apiKey));
            entity.setApiKeyHint(encryption.hint(entity.getApiKeyEnc()));
        }

        entity.setUpdatedAt(Instant.now());
        settingsRepository.save(entity);

        boolean hasKey = entity.getApiKeyEnc() != null && !entity.getApiKeyEnc().isBlank();
        return ResponseEntity.ok(Map.of(
                "configured", hasKey && entity.isEnabled(),
                "providerType", entity.getProviderType(),
                "baseUrl", entity.getBaseUrl() != null ? entity.getBaseUrl() : "",
                "model", entity.getModel() != null ? entity.getModel() : "",
                "apiKeyHint", hasKey ? encryption.hint(entity.getApiKeyEnc()) : "",
                "enabled", entity.isEnabled()
        ));
    }

    /**
     * Tests the AI provider connection using the saved or provided settings.
     * Accepts optional overrides in the request body; falls back to saved settings.
     */
    @PostMapping("/ai/test")
    public ResponseEntity<Map<String, Object>> testAiConnection(@RequestBody(required = false) Map<String, Object> body) {
        String apiKey = null;
        String baseUrl = null;
        String model = null;

        if (body != null) {
            apiKey = (String) body.getOrDefault("apiKey", null);
            baseUrl = (String) body.getOrDefault("baseUrl", null);
            model = (String) body.getOrDefault("model", null);
        }

        if (apiKey == null || apiKey.isBlank()) {
            apiKey = keyResolver.resolveKey();
        }
        if (baseUrl == null || baseUrl.isBlank()) {
            baseUrl = keyResolver.resolveBaseUrl();
        }
        if (model == null || model.isBlank()) {
            model = keyResolver.resolveModel();
        }

        if (apiKey == null || apiKey.isBlank()) {
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "status", "NOT_CONFIGURED",
                    "message", "No API key configured in any source"
            ));
        }
        if (baseUrl == null || baseUrl.isBlank()) {
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "status", "NOT_CONFIGURED",
                    "message", "No base URL configured"
            ));
        }

        long start = System.currentTimeMillis();
        try {
            Map<String, Object> payload = Map.of(
                    "model", model,
                    "temperature", 0.2,
                    "messages", java.util.List.of(
                            Map.of("role", "system", "content", "You are a system liveness probe."),
                            Map.of("role", "user", "content", "Reply with READY")));

            java.net.http.HttpClient client = java.net.http.HttpClient.newBuilder()
                    .connectTimeout(java.time.Duration.ofSeconds(10)).build();
            java.net.http.HttpRequest request = java.net.http.HttpRequest.newBuilder()
                    .uri(java.net.URI.create(baseUrl.replaceAll("/+$", "") + "/chat/completions"))
                    .timeout(java.time.Duration.ofSeconds(15))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofString(
                            new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(payload)))
                    .build();
            java.net.http.HttpResponse<String> response = client.send(request,
                    java.net.http.HttpResponse.BodyHandlers.ofString());

            long latencyMs = System.currentTimeMillis() - start;
            if (response.statusCode() / 100 == 2) {
                return ResponseEntity.ok(Map.of(
                        "success", true,
                        "status", "READY",
                        "latencyMs", latencyMs,
                        "model", model,
                        "message", "Connection successful"
                ));
            } else {
                String detail = response.body() != null && response.body().length() > 200
                        ? response.body().substring(0, 200) + "..." : response.body();
                return ResponseEntity.ok(Map.of(
                        "success", false,
                        "status", "ERROR",
                        "latencyMs", latencyMs,
                        "model", model,
                        "message", "HTTP " + response.statusCode() + ": " + detail
                ));
            }
        } catch (Exception e) {
            long latencyMs = System.currentTimeMillis() - start;
            String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "status", "ERROR",
                    "latencyMs", latencyMs,
                    "model", model != null ? model : "",
                    "message", msg
            ));
        }
    }

    /** Masks most of the URL for privacy, keeping the domain visible. */
    private String maskUrl(String url) {
        if (url == null || url.isBlank()) {
            return "";
        }
        try {
            java.net.URI uri = java.net.URI.create(url);
            String host = uri.getHost();
            if (host == null) {
                return "***";
            }
            return uri.getScheme() + "://" + host + "/***";
        } catch (Exception e) {
            return "***";
        }
    }
}
