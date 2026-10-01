package com.abada.engine.llm;

import org.springframework.stereotype.Component;

/**
 * Key, base URL and model of the provider used by Insight and APL authoring.
 * A thin view over {@link AiProviderRegistry}, which applies the precedence
 * Studio (Settings &rarr; AI Providers) over environment ({@code ABADA_LLM_*}).
 */
@Component
public class LlmKeyResolver {

    private final AiProviderRegistry registry;

    public LlmKeyResolver(AiProviderRegistry registry) {
        this.registry = registry;
    }

    /** The resolved API key, or null if no source provides one. */
    public String resolveKey() {
        return registry.insightProvider().map(ResolvedAiProvider::apiKey).orElse(null);
    }

    public boolean isConfigured() {
        return registry.isConfigured();
    }

    public String resolveBaseUrl() {
        return registry.insightProvider().map(ResolvedAiProvider::baseUrl).orElse(null);
    }

    public String resolveModel() {
        return registry.insightModel();
    }
}
