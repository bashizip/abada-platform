package io.abada.agent;

import java.net.URI;
import java.util.List;
import java.util.Locale;

/**
 * One LLM provider endpoint the worker can call: from the engine (Studio
 * settings over engine environment) or, as a fallback, from the worker's own
 * deprecated {@code ABADA_AGENT_LLM_*} / {@code ABADA_AGENT_OPENAI_*} variables.
 * {@link #toString()} never prints the key.
 */
record ProviderEndpoint(
        String id,
        String type,
        URI baseUrl,
        String apiKey,
        List<String> modelPatterns,
        String defaultModel,
        boolean fallback,
        Source source) {

    enum Source { ENGINE, WORKER_ENVIRONMENT }

    ProviderEndpoint {
        modelPatterns = modelPatterns == null ? List.of() : List.copyOf(modelPatterns);
    }

    boolean isGemini() {
        return "gemini".equals(type);
    }

    /** Longest pattern {@code model} starts with; -1 when none, 0 for {@code *}. */
    int matchLength(String model) {
        if (model == null || model.isBlank()) return -1;
        String normalized = model.strip().toLowerCase(Locale.ROOT);
        int best = -1;
        for (String pattern : modelPatterns) {
            if ("*".equals(pattern)) {
                best = Math.max(best, 0);
            } else if (normalized.startsWith(pattern.toLowerCase(Locale.ROOT))) {
                best = Math.max(best, pattern.length());
            }
        }
        return best;
    }

    /** The model id the provider expects: {@code anthropic/claude-x} becomes {@code claude-x} for Anthropic. */
    String upstreamModel(String model) {
        String prefix = switch (type == null ? "" : type) {
            case "gemini" -> "google/";
            case "openai" -> "openai/";
            case "anthropic" -> "anthropic/";
            default -> null;
        };
        if (model == null || prefix == null) return model;
        String stripped = model.strip();
        return stripped.regionMatches(true, 0, prefix, 0, prefix.length())
                ? stripped.substring(prefix.length()) : stripped;
    }

    @Override
    public String toString() {
        return "ProviderEndpoint[id=" + id + ", type=" + type + ", baseUrl=" + baseUrl + ", source=" + source
                + ", apiKey=****]";
    }
}
