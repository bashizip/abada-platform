package com.abada.engine.llm;

import java.util.List;

/**
 * One usable AI provider after the Studio-over-environment merge. Holds the
 * plaintext key in memory only; {@link #toString()} never prints it.
 */
public record ResolvedAiProvider(
        String id,
        AiProviderType type,
        String displayName,
        String baseUrl,
        String apiKey,
        List<String> modelPatterns,
        String defaultModel,
        long timeoutMs,
        Source source,
        boolean insightDefault,
        String fingerprint) {

    /** Where the key came from. Studio (database) wins over the environment. */
    public enum Source { STUDIO, ENVIRONMENT }

    public ResolvedAiProvider {
        modelPatterns = modelPatterns == null ? List.of() : List.copyOf(modelPatterns);
    }

    public String apiKeyHint() {
        return hint(apiKey);
    }

    /** Longest pattern of this provider that {@code model} starts with; -1 when none, 0 for {@code *}. */
    int matchLength(String model) {
        if (model == null || model.isBlank()) return -1;
        String normalized = model.strip().toLowerCase(java.util.Locale.ROOT);
        int best = -1;
        for (String pattern : modelPatterns) {
            if ("*".equals(pattern)) {
                best = Math.max(best, 0);
            } else if (normalized.startsWith(pattern.toLowerCase(java.util.Locale.ROOT))) {
                best = Math.max(best, pattern.length());
            }
        }
        return best;
    }

    static String hint(String key) {
        if (key == null || key.isBlank()) return "";
        return "****" + (key.length() > 4 ? key.substring(key.length() - 4) : "");
    }

    @Override
    public String toString() {
        return "ResolvedAiProvider[id=" + id + ", type=" + type.id() + ", baseUrl=" + baseUrl
                + ", apiKey=" + apiKeyHint() + ", source=" + source + "]";
    }
}
