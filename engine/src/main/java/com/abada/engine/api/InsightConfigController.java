package com.abada.engine.api;

import com.abada.engine.insight.InsightProperties;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read-only insight engine configuration for Studio settings display.
 * The actual configuration is managed via environment variables and
 * Spring properties; this endpoint surfaces the active values for the
 * Studio UI without exposing secrets.
 */
@RestController
@RequestMapping("/v1/insight/config")
public class InsightConfigController {

    private final InsightProperties properties;

    public InsightConfigController(InsightProperties properties) {
        this.properties = properties;
    }

    /**
     * Returns the current LLM provider configuration (excluding the API key).
     * The API key is never returned; its presence is indicated by isConfigured.
     */
    @GetMapping("/llm")
    public ResponseEntity<Map<String, Object>> getLlmConfig() {
        return ResponseEntity.ok(Map.of(
                "enabled", properties.isEnabled(),
                "configured", properties.isLlmConfigured(),
                "providerType", properties.getLlmProviderType(),
                "baseUrl", maskUrl(properties.getLlmBaseUrl()),
                "model", properties.getLlmModel(),
                "openRouterEnabled", properties.isOpenRouterEnabled(),
                "openRouterReferer", properties.getOpenRouterReferer(),
                "openRouterTitle", properties.getOpenRouterTitle()
        ));
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
