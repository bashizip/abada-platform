package com.abada.engine.api;

import com.abada.engine.dto.AiConnectionTestRequest;
import com.abada.engine.dto.AiConnectionTestResult;
import com.abada.engine.dto.AiProviderDTO;
import com.abada.engine.dto.AiProviderRequest;
import com.abada.engine.insight.InsightProperties;
import com.abada.engine.llm.AiProviderRegistry;
import com.abada.engine.llm.AiProviderService;
import com.abada.engine.llm.AiProviderType;
import com.abada.engine.llm.ResolvedAiProvider;
import java.util.LinkedHashMap;
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
 * Insight's view of the AI provider configuration. Since 1.0.0-rc.8 these are
 * compatibility endpoints over {@code /v1/ai-providers}: they read and write
 * the provider Insight uses (the Insight default). The API key is never
 * exposed in responses.
 */
@RestController
@RequestMapping("/v1/insight/config")
public class InsightConfigController {

    private final InsightProperties properties;
    private final AiProviderRegistry registry;
    private final AiProviderService providers;

    public InsightConfigController(InsightProperties properties, AiProviderRegistry registry,
                                   AiProviderService providers) {
        this.properties = properties;
        this.registry = registry;
        this.providers = providers;
    }

    @PostMapping("/llm/test")
    public ResponseEntity<Map<String, Object>> testLlmConnection() {
        return ResponseEntity.ok(toMap(providers.test(insightProviderId(), null)));
    }

    @GetMapping("/llm")
    public ResponseEntity<Map<String, Object>> getLlmConfig() {
        Optional<ResolvedAiProvider> insight = registry.insightProvider();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("enabled", properties.isEnabled());
        body.put("configured", insight.isPresent());
        body.put("providerType", insight.map(provider -> provider.type().id()).orElse(properties.getLlmProviderType()));
        body.put("providerId", insight.map(ResolvedAiProvider::id).orElse(""));
        body.put("source", insight.map(provider -> provider.source().name()).orElse(""));
        body.put("baseUrl", maskUrl(insight.map(ResolvedAiProvider::baseUrl).orElse(null)));
        body.put("model", registry.insightModel());
        body.put("openRouterEnabled", properties.isOpenRouterEnabled());
        body.put("openRouterReferer", properties.getOpenRouterReferer());
        body.put("openRouterTitle", properties.getOpenRouterTitle());
        return ResponseEntity.ok(body);
    }

    /** The provider Insight uses; {@code configured} honours both Studio and environment keys. */
    @GetMapping("/ai")
    public ResponseEntity<Map<String, Object>> getAiSettings() {
        Optional<ResolvedAiProvider> insight = registry.insightProvider();
        Optional<AiProviderDTO> saved = providers.list().stream()
                .filter(view -> view.saved() && view.insightDefault()).findFirst()
                .or(() -> insight.flatMap(active -> providers.list().stream()
                        .filter(view -> view.id().equals(active.id())).findFirst()));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("configured", insight.isPresent());
        body.put("providerType", saved.map(AiProviderDTO::providerType)
                .orElse(insight.map(provider -> provider.type().id()).orElse("openai-compatible")));
        body.put("baseUrl", saved.map(AiProviderDTO::baseUrl).orElse(""));
        body.put("model", saved.map(AiProviderDTO::defaultModel).orElse(registry.insightModel()));
        body.put("apiKeyHint", saved.map(view -> view.saved() ? view.apiKeyHint() : "").orElse(""));
        body.put("enabled", saved.map(AiProviderDTO::enabled).orElse(false));
        return ResponseEntity.ok(body);
    }

    /** Saves the Insight provider (the pre-rc.8 single-provider form). A blank key keeps the stored one. */
    @PutMapping("/ai")
    public ResponseEntity<Map<String, Object>> saveAiSettings(@RequestBody Map<String, Object> body) {
        AiProviderType type = AiProviderType.fromId((String) body.get("providerType"))
                .orElse(AiProviderType.OPENAI_COMPATIBLE);
        Object timeout = body.get("timeoutMs");
        providers.save(type.id(), new AiProviderRequest(null, type.id(), (String) body.get("baseUrl"),
                (String) body.get("apiKey"), null, (String) body.get("model"),
                timeout instanceof Number number ? number.longValue() : null,
                body.containsKey("enabled") ? Boolean.TRUE.equals(body.get("enabled")) : null, true));
        return getAiSettings();
    }

    /** Tests the Insight provider, with optional unsaved overrides. */
    @PostMapping("/ai/test")
    public ResponseEntity<Map<String, Object>> testAiConnection(@RequestBody(required = false) Map<String, Object> body) {
        AiConnectionTestRequest request = body == null ? null : new AiConnectionTestRequest(
                (String) body.get("providerType"), (String) body.get("baseUrl"),
                (String) body.get("apiKey"), (String) body.get("model"));
        String id = body != null && body.get("providerType") instanceof String type
                ? AiProviderType.fromId(type).map(AiProviderType::id).orElse(insightProviderId())
                : insightProviderId();
        return ResponseEntity.ok(toMap(providers.test(id, request)));
    }

    private String insightProviderId() {
        return registry.insightProvider().map(ResolvedAiProvider::id).orElse(null);
    }

    private static Map<String, Object> toMap(AiConnectionTestResult result) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", result.success());
        body.put("status", result.status());
        if (result.latencyMs() != null) body.put("latencyMs", result.latencyMs());
        body.put("model", result.model() == null ? "" : result.model());
        body.put("message", result.message());
        return body;
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
