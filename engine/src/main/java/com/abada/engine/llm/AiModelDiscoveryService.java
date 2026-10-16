package com.abada.engine.llm;

import com.abada.engine.persistence.entity.AiProviderModelsEntity;
import com.abada.engine.persistence.repository.AiProviderModelsRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The models each configured provider offers, read from the provider's own
 * {@code /models} endpoint with the key it was given: when a key is saved, once
 * a day, and on demand. A model a provider lists, and that routes to that
 * provider, is allowed for agent nodes alongside the operator's allow-list, so a
 * new model can be used the day its provider publishes it.
 */
@Service
public class AiModelDiscoveryService implements Supplier<Set<String>> {
    private static final Logger log = LoggerFactory.getLogger(AiModelDiscoveryService.class);
    private static final Duration CACHE = Duration.ofSeconds(30);

    public record ProviderModels(String providerId, List<String> models, Instant refreshedAt, String lastError) {}

    private final AiProviderModelsRepository repository;
    private final AiProviderRegistry registry;
    private final AiProviderGateway gateway;
    private final AiRefreshLeases leases;
    private final TransactionTemplate transactions;
    private final boolean enabled;
    private final Duration refreshInterval;
    private volatile Set<String> cached = Set.of();
    private volatile Instant cachedAt = Instant.EPOCH;

    public AiModelDiscoveryService(AiProviderModelsRepository repository, AiProviderRegistry registry,
            AiProviderGateway gateway, AiRefreshLeases leases, PlatformTransactionManager transactionManager,
            @Value("${abada.ai.model-discovery.enabled:true}") boolean enabled,
            @Value("${abada.ai.model-discovery.refresh-hours:24}") long refreshHours) {
        this.repository = repository;
        this.registry = registry;
        this.gateway = gateway;
        this.leases = leases;
        this.transactions = new TransactionTemplate(transactionManager);
        this.enabled = enabled;
        this.refreshInterval = Duration.ofHours(Math.max(1, refreshHours));
    }

    /**
     * The discovered models of the active providers that route back to the
     * provider that listed them. Cached for a few seconds; validation reads it often.
     */
    @Override
    public Set<String> get() {
        if (Duration.between(cachedAt, Instant.now()).compareTo(CACHE) < 0) return cached;
        Set<String> models = new TreeSet<>();
        for (ProviderModels provider : list()) {
            for (String model : provider.models()) {
                if (registry.resolveForModel(model).map(ResolvedAiProvider::id)
                        .filter(provider.providerId()::equals).isPresent()) {
                    models.add(model);
                }
            }
        }
        cached = Set.copyOf(models);
        cachedAt = Instant.now();
        return cached;
    }

    /** What each active provider listed, and when. */
    public List<ProviderModels> list() {
        Map<String, AiProviderModelsEntity> rows = new LinkedHashMap<>();
        transactions.execute(status -> {
            repository.findAll().forEach(row -> rows.put(row.getProviderId(), row));
            return null;
        });
        return registry.activeProviders().stream().map(provider -> {
            AiProviderModelsEntity row = rows.get(provider.id());
            return row == null ? new ProviderModels(provider.id(), List.of(), null, null)
                    : new ProviderModels(provider.id(), split(row.getModels()), row.getRefreshedAt(), row.getLastError());
        }).toList();
    }

    @Scheduled(fixedDelayString = "${abada.ai.model-discovery.check-interval-ms:3600000}",
            initialDelayString = "${abada.ai.model-discovery.initial-delay-ms:90000}")
    public void scheduledRefresh() {
        for (ResolvedAiProvider provider : registry.activeProviders()) refresh(provider.id(), false);
    }

    /** Reads the provider's model list when due (or {@code force}); never throws. */
    public ProviderModels refresh(String providerId, boolean force) {
        ResolvedAiProvider provider = registry.activeProviders().stream()
                .filter(candidate -> candidate.id().equals(providerId)).findFirst().orElse(null);
        if (!enabled || provider == null || !leases.claim("models:" + providerId, refreshInterval, force)) {
            return current(providerId);
        }
        Instant now = Instant.now();
        try {
            List<String> models = gateway.listModels(provider, Duration.ofSeconds(15));
            store(providerId, models, now, null);
            leases.finish("models:" + providerId, true, null, models.size());
        } catch (Exception exception) {
            String message = exception.getMessage() == null ? exception.getClass().getSimpleName()
                    : exception.getMessage();
            if (provider.apiKey() != null) message = message.replace(provider.apiKey(), "****");
            store(providerId, null, now, message);
            leases.finish("models:" + providerId, false, message, null);
            log.warn("model_discovery_failed provider={} reason={}", providerId, message);
        }
        cachedAt = Instant.EPOCH;
        return current(providerId);
    }

    private ProviderModels current(String providerId) {
        return list().stream().filter(view -> view.providerId().equals(providerId)).findFirst()
                .orElse(new ProviderModels(providerId, List.of(), null, null));
    }

    private void store(String providerId, List<String> models, Instant at, String error) {
        transactions.executeWithoutResult(status -> {
            AiProviderModelsEntity row = repository.findById(providerId).orElseGet(() -> {
                AiProviderModelsEntity created = new AiProviderModelsEntity();
                created.setProviderId(providerId);
                return created;
            });
            row.setLastAttemptAt(at);
            row.setLastError(error == null ? null : error.substring(0, Math.min(error.length(), 1000)));
            if (models != null) {
                row.setModels(String.join("\n", models));
                row.setRefreshedAt(at);
            }
            repository.save(row);
        });
    }

    private static List<String> split(String value) {
        if (value == null || value.isBlank()) return List.of();
        return Arrays.stream(value.split("\n")).map(String::strip).filter(model -> !model.isEmpty()).toList();
    }
}
