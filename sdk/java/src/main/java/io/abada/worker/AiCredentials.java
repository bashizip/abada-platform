package io.abada.worker;

import java.util.List;

/**
 * AI provider credentials the engine resolved for the calling agent worker
 * ({@code GET /v1/workers/me/ai-credentials}): keys saved in Studio take
 * precedence over the engine's environment. {@code revision} changes whenever
 * a provider, endpoint or key changes. Neither record prints a key from
 * {@link #toString()}.
 */
public record AiCredentials(String revision, List<Provider> providers) {

    public AiCredentials {
        providers = providers == null ? List.of() : List.copyOf(providers);
    }

    /**
     * One provider endpoint. Models route to the provider with the longest
     * matching {@code modelPatterns} prefix ({@code *} matches any model).
     */
    public record Provider(
            String id,
            String type,
            String baseUrl,
            String apiKey,
            List<String> modelPatterns,
            String defaultModel,
            Long timeoutMs,
            boolean fallback) {

        public Provider {
            modelPatterns = modelPatterns == null ? List.of() : List.copyOf(modelPatterns);
        }

        @Override
        public String toString() {
            return "Provider[id=" + id + ", type=" + type + ", baseUrl=" + baseUrl + ", apiKey=****]";
        }
    }
}
