package com.abada.engine.llm;

import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Provider presets. Every provider is called through its OpenAI-compatible
 * {@code POST {baseUrl}/chat/completions} endpoint with a Bearer key; the
 * preset supplies the base URL, the model prefixes routed to it by default and
 * the namespace prefix stripped from a model id before it is sent upstream.
 */
public enum AiProviderType {
    GEMINI("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai",
            List.of("gemini", "google/"), "gemini-3.6-flash", "google/"),
    OPENAI("openai", "OpenAI", "https://api.openai.com/v1",
            List.of("gpt-", "o1", "o3", "o4", "openai/"), "gpt-5-mini", "openai/"),
    ANTHROPIC("anthropic", "Anthropic", "https://api.anthropic.com/v1",
            List.of("claude", "anthropic/"), "claude-sonnet-5", "anthropic/"),
    DEEPSEEK("deepseek", "DeepSeek", "https://api.deepseek.com/v1",
            List.of("deepseek-"), "deepseek-chat", null),
    OPENROUTER("openrouter", "OpenRouter", "https://openrouter.ai/api/v1",
            List.of("deepseek/", "meta-llama/", "mistralai/", "qwen/", "x-ai/", "openrouter/"),
            "deepseek/deepseek-v4-flash-free", null),
    OPENAI_COMPATIBLE("openai-compatible", "OpenAI-compatible", null, List.of("*"), null, null);

    private final String id;
    private final String displayName;
    private final String defaultBaseUrl;
    private final List<String> defaultModelPatterns;
    private final String defaultModel;
    private final String namespacePrefix;

    AiProviderType(String id, String displayName, String defaultBaseUrl, List<String> defaultModelPatterns,
            String defaultModel, String namespacePrefix) {
        this.id = id;
        this.displayName = displayName;
        this.defaultBaseUrl = defaultBaseUrl;
        this.defaultModelPatterns = defaultModelPatterns;
        this.defaultModel = defaultModel;
        this.namespacePrefix = namespacePrefix;
    }

    public String id() { return id; }
    public String displayName() { return displayName; }
    public String defaultBaseUrl() { return defaultBaseUrl; }
    public List<String> defaultModelPatterns() { return defaultModelPatterns; }
    public String defaultModel() { return defaultModel; }

    /** Env-var infix for the per-provider keys, e.g. {@code GEMINI} in {@code ABADA_LLM_GEMINI_API_KEY}. */
    public String envName() {
        return name();
    }

    /** The model id as the provider expects it: {@code google/gemini-x} becomes {@code gemini-x} for Gemini. */
    public String upstreamModel(String model) {
        if (model == null || namespacePrefix == null) return model;
        return model.regionMatches(true, 0, namespacePrefix, 0, namespacePrefix.length())
                ? model.substring(namespacePrefix.length()) : model;
    }

    public static Optional<AiProviderType> fromId(String value) {
        if (value == null || value.isBlank()) return Optional.empty();
        String normalized = value.strip().toLowerCase(Locale.ROOT);
        for (AiProviderType type : values()) {
            if (type.id.equals(normalized)) return Optional.of(type);
        }
        if ("google".equals(normalized) || "google-gemini".equals(normalized)) return Optional.of(GEMINI);
        if ("custom".equals(normalized) || "openai_compatible".equals(normalized)) {
            return Optional.of(OPENAI_COMPATIBLE);
        }
        return Optional.empty();
    }

    /** Best guess for a bare {@code ABADA_LLM_BASE_URL} without {@code ABADA_LLM_PROVIDER}. */
    public static AiProviderType infer(String baseUrl, String model) {
        String url = baseUrl == null ? "" : baseUrl.toLowerCase(Locale.ROOT);
        if (url.contains("generativelanguage.googleapis.com")) return GEMINI;
        if (url.contains("openrouter.ai")) return OPENROUTER;
        if (url.contains("api.openai.com")) return OPENAI;
        if (url.contains("api.anthropic.com")) return ANTHROPIC;
        if (url.contains("api.deepseek.com")) return DEEPSEEK;
        if (url.isBlank() && model != null && model.toLowerCase(Locale.ROOT).startsWith("gemini")) return GEMINI;
        return OPENAI_COMPATIBLE;
    }
}
