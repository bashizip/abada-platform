package com.abada.engine.dto;

import java.util.List;

/**
 * An AI provider as Studio shows it. Never carries the key, only its hint.
 * {@code activeSource} says which source currently serves this provider id:
 * {@code STUDIO} (saved, enabled, with a key), {@code ENVIRONMENT} or null.
 */
public record AiProviderDTO(
        String id,
        String displayName,
        String providerType,
        String baseUrl,
        String apiKeyHint,
        List<String> modelPatterns,
        String defaultModel,
        long timeoutMs,
        boolean enabled,
        boolean insightDefault,
        boolean saved,
        boolean configured,
        String activeSource,
        boolean environmentConfigured,
        String environmentKeyHint) {
}
