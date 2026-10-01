package com.abada.engine.dto;

import java.util.List;

/**
 * Create or update a Studio AI provider. A null or blank {@code apiKey} keeps
 * the stored key; null fields keep their current value.
 */
public record AiProviderRequest(
        String displayName,
        String providerType,
        String baseUrl,
        String apiKey,
        List<String> modelPatterns,
        String defaultModel,
        Long timeoutMs,
        Boolean enabled,
        Boolean insightDefault) {

    @Override
    public String toString() {
        return "AiProviderRequest[displayName=" + displayName + ", providerType=" + providerType
                + ", baseUrl=" + baseUrl + ", apiKey=" + (apiKey == null || apiKey.isBlank() ? "" : "****") + "]";
    }
}
