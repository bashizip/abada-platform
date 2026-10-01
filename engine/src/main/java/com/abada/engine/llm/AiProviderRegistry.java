package com.abada.engine.llm;

import com.abada.engine.insight.InsightProperties;
import com.abada.engine.persistence.entity.AiProviderEntity;
import com.abada.engine.persistence.repository.AiProviderRepository;
import com.abada.engine.security.AesEncryption;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * The single answer to "which AI provider, key and endpoint serve this model?"
 * for agent tasks (through the worker credentials endpoint), Insight and APL
 * authoring.
 *
 * <p>Providers come from two sources, merged per provider id:
 * <ol>
 *   <li>Studio (Settings &rarr; AI Providers): rows in {@code ai_providers},
 *       keys AES-GCM encrypted. An enabled row with a key wins.</li>
 *   <li>Environment, a developer/bootstrap default: {@code ABADA_LLM_API_KEY}
 *       with {@code ABADA_LLM_BASE_URL}, {@code ABADA_LLM_MODEL} and
 *       {@code ABADA_LLM_PROVIDER}; per-provider {@code ABADA_LLM_<TYPE>_API_KEY}
 *       (and {@code _BASE_URL}); and, deprecated, the worker-only
 *       {@code ABADA_AGENT_LLM_*} and {@code ABADA_AGENT_OPENAI_*} pairs.</li>
 * </ol>
 * A model routes to the provider whose pattern is its longest prefix match
 * ({@code *} matches any model, last); an unmatched model has no provider.
 * Nothing here logs or returns a key except {@link ResolvedAiProvider#apiKey()}.
 */
@Component
public class AiProviderRegistry {
    private static final Logger log = LoggerFactory.getLogger(AiProviderRegistry.class);
    private static final List<AiProviderType> PER_TYPE_ENV = List.of(AiProviderType.GEMINI, AiProviderType.OPENAI,
            AiProviderType.ANTHROPIC, AiProviderType.DEEPSEEK, AiProviderType.OPENROUTER);

    private final AiProviderRepository repository;
    private final AesEncryption encryption;
    private final InsightProperties insightProperties;
    private final Environment environment;
    private final Set<String> warned = ConcurrentHashMap.newKeySet();

    public AiProviderRegistry(AiProviderRepository repository, AesEncryption encryption,
            InsightProperties insightProperties, Environment environment) {
        this.repository = repository;
        this.encryption = encryption;
        this.insightProperties = insightProperties;
        this.environment = environment;
    }

    /** Every usable provider (has a key and a base URL), Studio winning over environment per id. */
    public List<ResolvedAiProvider> activeProviders() {
        Map<String, ResolvedAiProvider> merged = new LinkedHashMap<>();
        for (ResolvedAiProvider provider : environmentProviders()) merged.put(provider.id(), provider);
        for (AiProviderEntity row : repository.findAll()) {
            studioProvider(row).ifPresent(provider -> merged.put(provider.id(), provider));
        }
        return List.copyOf(merged.values());
    }

    /**
     * The provider serving {@code model}: the longest matching prefix pattern,
     * where {@code *} (a catch-all gateway) matches last. No match means no
     * provider: a model is never sent to a provider that does not serve it.
     * A task without a model can use the Insight provider.
     */
    public Optional<ResolvedAiProvider> resolveForModel(String model) {
        List<ResolvedAiProvider> providers = activeProviders();
        if (model == null || model.isBlank()) return insightProvider(providers);
        return providers.stream()
                .filter(provider -> provider.matchLength(model) >= 0)
                .max(Comparator.comparingInt(provider -> provider.matchLength(model)));
    }

    /** The provider used by Insight and APL authoring. */
    public Optional<ResolvedAiProvider> insightProvider() {
        return insightProvider(activeProviders());
    }

    /** Model for Insight and authoring: the provider's default model, else {@code ABADA_LLM_MODEL}. */
    public String insightModel() {
        return insightProvider().map(provider -> firstNonBlank(provider.defaultModel(),
                        provider.type().defaultModel(), insightProperties.getLlmModel()))
                .orElse(insightProperties.getLlmModel());
    }

    public boolean isConfigured() {
        return insightProvider().isPresent();
    }

    /**
     * Changes whenever a provider, endpoint or key changes, so a worker can
     * tell that its cached credentials are stale. Derived from hashes only.
     */
    public String revision() {
        return sha256(String.join("|", activeProviders().stream().map(ResolvedAiProvider::fingerprint).toList()))
                .substring(0, 16);
    }

    /** The environment-provided provider with this id, if any (for Studio's source badges). */
    public Optional<ResolvedAiProvider> environmentProvider(String id) {
        return environmentProviders().stream().filter(provider -> provider.id().equals(id)).findFirst();
    }

    /** A Studio row as a provider; empty when disabled, keyless or its key cannot be decrypted. */
    public Optional<ResolvedAiProvider> studioProvider(AiProviderEntity row) {
        if (!row.isEnabled() || !row.hasKey()) return Optional.empty();
        AiProviderType type = AiProviderType.fromId(row.getProviderType()).orElse(AiProviderType.OPENAI_COMPATIBLE);
        String baseUrl = normalizeBaseUrl(type, firstNonBlank(row.getBaseUrl(), type.defaultBaseUrl()));
        if (baseUrl == null) return Optional.empty();
        String key;
        try {
            key = encryption.decrypt(row.getApiKeyEnc());
        } catch (RuntimeException exception) {
            warnOnce("undecryptable:" + row.getId(), "ai_provider_key_unreadable id={} reason=decryption_failed "
                    + "(was ABADA_ENCRYPTION_KEY changed?)", row.getId());
            return Optional.empty();
        }
        List<String> patterns = splitPatterns(row.getModelPatterns());
        return Optional.of(new ResolvedAiProvider(row.getId(), type,
                firstNonBlank(row.getDisplayName(), type.displayName()), baseUrl, key,
                patterns.isEmpty() ? type.defaultModelPatterns() : patterns,
                firstNonBlank(row.getDefaultModel(), type.defaultModel()), row.getTimeoutMs(),
                ResolvedAiProvider.Source.STUDIO, row.isInsightDefault(),
                fingerprint(row.getId(), "studio", baseUrl, key, row.getModelPatterns(),
                        String.valueOf(row.getVersion()))));
    }

    /** Providers configured through environment variables, in precedence order. */
    public List<ResolvedAiProvider> environmentProviders() {
        Map<String, ResolvedAiProvider> providers = new LinkedHashMap<>();
        long timeoutMs = insightProperties.getLlmTimeout().toMillis();

        for (AiProviderType type : PER_TYPE_ENV) {
            String key = env("ABADA_LLM_" + type.envName() + "_API_KEY");
            if (key == null) continue;
            String baseUrl = normalizeBaseUrl(type,
                    firstNonBlank(env("ABADA_LLM_" + type.envName() + "_BASE_URL"), type.defaultBaseUrl()));
            providers.put(type.id(), environment(type, baseUrl, key, type.defaultModel(), timeoutMs, false));
        }

        String defaultKey = blankToNull(insightProperties.getLlmApiKey());
        if (defaultKey != null) {
            String configuredBase = blankToNull(insightProperties.getLlmBaseUrl());
            AiProviderType type = AiProviderType.fromId(env("ABADA_LLM_PROVIDER"))
                    .orElseGet(() -> AiProviderType.infer(configuredBase, insightProperties.getLlmModel()));
            String baseUrl = normalizeBaseUrl(type, firstNonBlank(configuredBase, type.defaultBaseUrl()));
            ResolvedAiProvider existing = providers.get(type.id());
            if (existing == null && baseUrl != null) {
                providers.put(type.id(), environment(type, baseUrl, defaultKey,
                        insightProperties.getLlmModel(), timeoutMs, true));
            } else if (existing != null) {
                providers.put(type.id(), withInsightDefault(existing, insightProperties.getLlmModel()));
            }
        }

        addDeprecated(providers, "ABADA_AGENT_LLM_API_KEY", "ABADA_AGENT_LLM_BASE_URL",
                env("ABADA_AGENT_LLM_MODEL"), timeoutMs);
        addDeprecated(providers, "ABADA_AGENT_OPENAI_API_KEY", "ABADA_AGENT_OPENAI_BASE_URL", null, timeoutMs);
        return List.copyOf(providers.values());
    }

    private void addDeprecated(Map<String, ResolvedAiProvider> providers, String keyVar, String baseVar,
            String model, long timeoutMs) {
        String key = env(keyVar);
        String configuredBase = env(baseVar);
        if (key == null || configuredBase == null) return;
        AiProviderType type = AiProviderType.infer(configuredBase, model);
        if (providers.containsKey(type.id())) return;
        warnOnce(keyVar, "ai_provider_env_deprecated variable={} replacement=ABADA_LLM_{}_API_KEY "
                + "hint=prefer Studio Settings > AI Providers", keyVar, type.envName());
        String baseUrl = normalizeBaseUrl(type, configuredBase);
        if (baseUrl != null) {
            providers.put(type.id(), environment(type, baseUrl, key,
                    firstNonBlank(model, type.defaultModel()), timeoutMs, false));
        }
    }

    private Optional<ResolvedAiProvider> insightProvider(List<ResolvedAiProvider> providers) {
        return providers.stream().filter(provider -> provider.source() == ResolvedAiProvider.Source.STUDIO
                        && provider.insightDefault()).findFirst()
                .or(() -> providers.stream().filter(provider -> provider.source()
                        == ResolvedAiProvider.Source.ENVIRONMENT && provider.insightDefault()).findFirst())
                .or(() -> providers.stream().filter(provider -> provider.source()
                        == ResolvedAiProvider.Source.STUDIO).findFirst())
                .or(() -> providers.stream().findFirst());
    }

    private ResolvedAiProvider environment(AiProviderType type, String baseUrl, String key, String model,
            long timeoutMs, boolean insightDefault) {
        return new ResolvedAiProvider(type.id(), type, type.displayName(), baseUrl, key,
                type.defaultModelPatterns(), firstNonBlank(model, type.defaultModel()), timeoutMs,
                ResolvedAiProvider.Source.ENVIRONMENT, insightDefault,
                fingerprint(type.id(), "env", baseUrl, key, null, null));
    }

    private static ResolvedAiProvider withInsightDefault(ResolvedAiProvider provider, String model) {
        return new ResolvedAiProvider(provider.id(), provider.type(), provider.displayName(), provider.baseUrl(),
                provider.apiKey(), provider.modelPatterns(), firstNonBlank(model, provider.defaultModel()),
                provider.timeoutMs(), provider.source(), true, provider.fingerprint());
    }

    /**
     * Gemini's OpenAI-compatible surface lives under {@code /openai}; older
     * configuration stored the bare {@code /v1beta} base.
     */
    static String normalizeBaseUrl(AiProviderType type, String baseUrl) {
        String value = blankToNull(baseUrl);
        if (value == null) return null;
        value = value.strip().replaceAll("/+$", "");
        if (value.endsWith("/chat/completions")) {
            value = value.substring(0, value.length() - "/chat/completions".length());
        }
        if (type == AiProviderType.GEMINI && value.endsWith("/v1beta")) value = value + "/openai";
        return value;
    }

    public static List<String> splitPatterns(String value) {
        if (value == null || value.isBlank()) return List.of();
        return Arrays.stream(value.split(",")).map(String::strip).filter(pattern -> !pattern.isEmpty())
                .map(pattern -> pattern.toLowerCase(Locale.ROOT)).distinct().toList();
    }

    private String env(String name) {
        return blankToNull(environment.getProperty(name));
    }

    private void warnOnce(String key, String format, Object... arguments) {
        if (warned.add(key)) log.warn(format, arguments);
    }

    private static String fingerprint(String... parts) {
        List<String> values = new ArrayList<>();
        for (String part : parts) values.add(part == null ? "" : part);
        return sha256(String.join("\u0000", values)).substring(0, 16);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) return value;
        }
        return null;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
