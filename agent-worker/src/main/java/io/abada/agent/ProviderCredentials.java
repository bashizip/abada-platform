package io.abada.agent;

import io.abada.worker.AiCredentials;
import io.abada.worker.WorkerProtocolException;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.function.LongSupplier;

/**
 * Which provider endpoint serves a model. The engine's answer comes first: it
 * merges keys saved in Studio (Settings &rarr; AI Providers) over the engine
 * environment. It is cached for {@code ABADA_AGENT_CREDENTIALS_TTL_MS} and
 * refreshed at once after a provider rejects a key. The worker's own
 * deprecated environment endpoints apply only to models the engine does not
 * serve, or when the engine predates the credentials endpoint (HTTP 404).
 * Keys are never logged.
 */
final class ProviderCredentials {
    private static final System.Logger LOG = System.getLogger(ProviderCredentials.class.getName());

    /** The engine call; {@code null} for an environment-only worker. */
    interface EngineSource {
        AiCredentials fetch();
    }

    private record Snapshot(String revision, List<ProviderEndpoint> providers, long fetchedAtMillis) {}

    private final EngineSource engine;
    private final List<ProviderEndpoint> environment;
    private final Duration ttl;
    private final LongSupplier clockMillis;
    private volatile Snapshot snapshot;
    private volatile String lastUnavailableReason;

    ProviderCredentials(EngineSource engine, List<ProviderEndpoint> environment, Duration ttl,
            LongSupplier clockMillis) {
        this.engine = engine;
        this.environment = List.copyOf(environment);
        this.ttl = ttl;
        this.clockMillis = clockMillis;
    }

    static ProviderCredentials environmentOnly(WorkerConfig config) {
        return new ProviderCredentials(null, fromEnvironment(config), Duration.ZERO, System::currentTimeMillis);
    }

    /**
     * The deprecated worker-only endpoints, routed as before rc.8: Gemini
     * models to {@code ABADA_AGENT_LLM_*}, everything else to
     * {@code ABADA_AGENT_OPENAI_*}.
     */
    static List<ProviderEndpoint> fromEnvironment(WorkerConfig config) {
        List<ProviderEndpoint> endpoints = new ArrayList<>();
        if (config.llmBaseUrl() != null && hasText(config.llmApiKey())) {
            endpoints.add(new ProviderEndpoint("worker-env-gemini", "gemini", config.llmBaseUrl(), config.llmApiKey(),
                    List.of("gemini", "google/"), config.defaultModel(), false,
                    ProviderEndpoint.Source.WORKER_ENVIRONMENT));
        }
        if (config.openAiBaseUrl() != null && hasText(config.openAiApiKey())) {
            endpoints.add(new ProviderEndpoint("worker-env-openai", "openai-compatible", config.openAiBaseUrl(),
                    config.openAiApiKey(), List.of("*"), config.defaultModel(), true,
                    ProviderEndpoint.Source.WORKER_ENVIRONMENT));
        }
        return endpoints;
    }

    /** The endpoint for {@code model}, or empty when no provider serves it. */
    Optional<ProviderEndpoint> resolve(String model) {
        Optional<ProviderEndpoint> fromEngine = match(engineProviders(), model);
        return fromEngine.isPresent() ? fromEngine : match(environment, model);
    }

    /** Every key the worker currently holds, so reports to the engine can be redacted. */
    java.util.Set<String> knownKeys() {
        java.util.Set<String> keys = new java.util.HashSet<>();
        Snapshot current = snapshot;
        if (current != null) current.providers().forEach(provider -> keys.add(provider.apiKey()));
        environment.forEach(provider -> keys.add(provider.apiKey()));
        keys.remove(null);
        return keys;
    }

    /** Refetches from the engine now; true when the credentials changed. */
    synchronized boolean refresh() {
        if (engine == null) return false;
        String before = snapshot == null ? null : snapshot.revision();
        load();
        String after = snapshot == null ? null : snapshot.revision();
        return after != null && !after.equals(before);
    }

    /** Loads once at startup and logs where the credentials come from (never the keys). */
    void logSource() {
        List<ProviderEndpoint> providers = engineProviders();
        if (!providers.isEmpty()) {
            LOG.log(System.Logger.Level.INFO, "agent_credentials_loaded source=engine providers={0} revision={1}",
                    String.join(",", providers.stream().map(ProviderEndpoint::id).toList()), snapshot.revision());
        } else if (!environment.isEmpty()) {
            LOG.log(System.Logger.Level.INFO,
                    "agent_credentials_loaded source=worker_environment providers={0} reason={1}",
                    String.join(",", environment.stream().map(ProviderEndpoint::id).toList()),
                    lastUnavailableReason == null ? "engine_has_no_providers" : lastUnavailableReason);
        } else {
            LOG.log(System.Logger.Level.WARNING, "agent_credentials_missing hint=add an AI provider in "
                    + "Studio Settings > AI Providers");
        }
    }

    private List<ProviderEndpoint> engineProviders() {
        if (engine == null) return List.of();
        Snapshot current = snapshot;
        if (current == null || clockMillis.getAsLong() - current.fetchedAtMillis() >= ttl.toMillis()) {
            synchronized (this) {
                current = snapshot;
                if (current == null || clockMillis.getAsLong() - current.fetchedAtMillis() >= ttl.toMillis()) {
                    load();
                    current = snapshot;
                }
            }
        }
        return current == null ? List.of() : current.providers();
    }

    private void load() {
        long now = clockMillis.getAsLong();
        try {
            AiCredentials credentials = engine.fetch();
            List<ProviderEndpoint> providers = new ArrayList<>();
            for (AiCredentials.Provider provider : credentials.providers()) {
                if (!hasText(provider.apiKey()) || !hasText(provider.baseUrl())) continue;
                providers.add(new ProviderEndpoint(provider.id(), provider.type(), URI.create(provider.baseUrl()),
                        provider.apiKey(), provider.modelPatterns(), provider.defaultModel(), provider.fallback(),
                        ProviderEndpoint.Source.ENGINE));
            }
            snapshot = new Snapshot(credentials.revision(), List.copyOf(providers), now);
            lastUnavailableReason = null;
        } catch (WorkerProtocolException failure) {
            String reason = failure.status() == 404 ? "engine_without_credentials_endpoint"
                    : failure.status() == 403 ? "engine_denied_credentials"
                    : "engine_unreachable status=" + failure.status() + " code=" + failure.code();
            if (!reason.equals(lastUnavailableReason)) {
                LOG.log(System.Logger.Level.WARNING, "agent_credentials_unavailable reason={0}", reason);
            }
            lastUnavailableReason = reason;
            boolean permanent = failure.status() == 404 || failure.status() == 403;
            List<ProviderEndpoint> keep = permanent || snapshot == null ? List.of() : snapshot.providers();
            snapshot = new Snapshot(snapshot == null || permanent ? null : snapshot.revision(), keep, now);
        } catch (RuntimeException failure) {
            String reason = "engine_error type=" + failure.getClass().getSimpleName();
            if (!reason.equals(lastUnavailableReason)) {
                LOG.log(System.Logger.Level.WARNING, "agent_credentials_unavailable reason={0}", reason);
            }
            lastUnavailableReason = reason;
            snapshot = new Snapshot(snapshot == null ? null : snapshot.revision(),
                    snapshot == null ? List.of() : snapshot.providers(), now);
        }
    }

    private static Optional<ProviderEndpoint> match(List<ProviderEndpoint> providers, String model) {
        if (model == null || model.isBlank()) {
            return providers.stream().filter(ProviderEndpoint::fallback).findFirst()
                    .or(() -> providers.stream().findFirst());
        }
        return providers.stream().filter(provider -> provider.matchLength(model) >= 0)
                .max(Comparator.comparingInt(provider -> provider.matchLength(model)));
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
