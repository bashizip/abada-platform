package com.abada.engine.llm;

import com.abada.engine.core.model.ModelPrice;
import com.abada.engine.persistence.entity.ModelCatalogPriceEntity;
import com.abada.engine.persistence.repository.ModelCatalogPriceRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Suggested model prices from a public catalog (by default OpenRouter's model
 * list, which carries per-token prices for the models of Google, OpenAI,
 * Anthropic, DeepSeek and others), refreshed once a day, with the snapshot
 * shipped in the release as the floor when the catalog is off or unreachable.
 * An administrator's price always wins; these only fill the gap so a call is
 * not left unpriced. Rows are added when a price changes, never edited.
 */
@Service
public class ModelCatalogService {
    private static final Logger log = LoggerFactory.getLogger(ModelCatalogService.class);
    static final String LEASE_ID = "price-catalog";
    static final String SNAPSHOT_LEASE_ID = "price-catalog-snapshot";
    static final String SNAPSHOT_RESOURCE = "llm/model-price-snapshot.json";
    /** When the shipped snapshot was read from the catalog; its prices apply from then. */
    public static final Instant SNAPSHOT_TAKEN = Instant.parse("2026-10-16T00:00:00Z");
    public static final String SNAPSHOT_SOURCE = "snapshot-2026-10-16";

    public record CatalogStatus(boolean enabled, String url, Instant refreshedAt, String status, String message,
            Integer modelCount, Instant snapshotTaken) {}

    private final ModelCatalogPriceRepository catalog;
    private final AiProviderGateway gateway;
    private final AiRefreshLeases leases;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactions;
    private final boolean enabled;
    private final String url;
    private final Duration refreshInterval;

    public ModelCatalogService(ModelCatalogPriceRepository catalog, AiProviderGateway gateway, AiRefreshLeases leases,
            ObjectMapper objectMapper, PlatformTransactionManager transactionManager,
            @Value("${abada.ai.price-catalog.enabled:true}") boolean enabled,
            @Value("${abada.ai.price-catalog.url:https://openrouter.ai/api/v1/models}") String url,
            @Value("${abada.ai.price-catalog.refresh-hours:24}") long refreshHours) {
        this.catalog = catalog;
        this.gateway = gateway;
        this.leases = leases;
        this.objectMapper = objectMapper;
        this.transactions = new TransactionTemplate(transactionManager);
        this.enabled = enabled;
        this.url = url;
        this.refreshInterval = Duration.ofHours(Math.max(1, refreshHours));
    }

    /**
     * The matching key of a model id: lower case, without a vendor namespace, a
     * {@code :variant} or a date suffix, dots as dashes. {@code google/gemini-3.8-flash},
     * {@code gemini-3.8-flash} and {@code models/gemini-3.8-flash} share one key.
     */
    public static String key(String model) {
        if (model == null) return "";
        String value = model.strip().toLowerCase(Locale.ROOT);
        int variant = value.indexOf(':');
        if (variant >= 0) value = value.substring(0, variant);
        int slash = value.lastIndexOf('/');
        if (slash >= 0) value = value.substring(slash + 1);
        value = value.replace('.', '-');
        value = value.replaceAll("-(\\d{8}|\\d{4}-\\d{2}-\\d{2})$", "");
        return value;
    }

    /** The catalog price for a model at a time: the latest one in effect, preferring the model's own vendor. */
    public Optional<ModelPrice> priceAt(String model, Instant at) {
        return entryAt(model, at).map(row -> new ModelPrice(row.getInputPerMillion(), row.getOutputPerMillion()));
    }

    /** The catalog row that prices {@code model} at {@code at}, if any. */
    public Optional<ModelCatalogPriceEntity> entryAt(String model, Instant at) {
        if (model == null || model.isBlank()) return Optional.empty();
        List<ModelCatalogPriceEntity> rows =
                catalog.findByModelKeyAndEffectiveFromLessThanEqualOrderByEffectiveFromDesc(key(model), at);
        if (rows.isEmpty()) return Optional.empty();
        String vendor = vendorOf(model);
        if (vendor != null) {
            for (ModelCatalogPriceEntity row : rows) {
                if (vendor.equals(vendorOf(row.getModel()))) return Optional.of(row);
            }
        }
        return Optional.of(rows.get(0));
    }

    public CatalogStatus status() {
        var state = leases.state(LEASE_ID);
        return new CatalogStatus(enabled, url, state.map(s -> s.getRefreshedAt()).orElse(null),
                state.map(s -> s.getStatus()).orElse(null), state.map(s -> s.getMessage()).orElse(null),
                state.map(s -> s.getItemCount()).orElse(null), SNAPSHOT_TAKEN);
    }

    @Scheduled(fixedDelayString = "${abada.ai.price-catalog.check-interval-ms:3600000}",
            initialDelayString = "${abada.ai.price-catalog.initial-delay-ms:60000}")
    public void scheduledRefresh() {
        refresh(false);
    }

    /** Reads the catalog when it is due (or {@code force}) and records changed prices. */
    public CatalogStatus refresh(boolean force) {
        if (!enabled || !leases.claim(LEASE_ID, refreshInterval, force)) return status();
        try {
            List<AiProviderGateway.CatalogPrice> prices = gateway.fetchCatalog(url, Duration.ofSeconds(30));
            int changed = record(prices, Instant.now(), "catalog:" + hostOf(url));
            leases.finish(LEASE_ID, true, changed + " price(s) changed", prices.size());
            if (changed > 0) log.info("price_catalog_refreshed models={} changed={}", prices.size(), changed);
        } catch (Exception exception) {
            String message = exception.getMessage() == null ? exception.getClass().getSimpleName()
                    : exception.getMessage();
            leases.finish(LEASE_ID, false, message, null);
            log.warn("price_catalog_refresh_failed reason={}", message);
        }
        return status();
    }

    /** Loads the shipped snapshot once, so prices exist even before (or without) the first catalog read. */
    @EventListener(ApplicationReadyEvent.class)
    public void importSnapshot() {
        if (!leases.claim(SNAPSHOT_LEASE_ID, Duration.ofDays(36_500), false)) return;
        try (InputStream in = new ClassPathResource(SNAPSHOT_RESOURCE).getInputStream()) {
            List<AiProviderGateway.CatalogPrice> prices = AiProviderGateway.parseCatalog(objectMapper.readTree(in));
            int added = record(prices, SNAPSHOT_TAKEN, SNAPSHOT_SOURCE);
            leases.finish(SNAPSHOT_LEASE_ID, true, added + " price(s) imported", prices.size());
        } catch (Exception exception) {
            leases.finish(SNAPSHOT_LEASE_ID, false, exception.getMessage(), null);
            log.warn("price_snapshot_import_failed reason={}", exception.getMessage());
        }
    }

    /** Adds a row for every model whose latest price differs; returns how many were added. */
    int record(List<AiProviderGateway.CatalogPrice> prices, Instant effectiveFrom, String source) {
        try {
            return transactions.execute(status -> {
                Map<String, ModelCatalogPriceEntity> latest = new HashMap<>();
                for (ModelCatalogPriceEntity row : catalog.findAll()) {
                    ModelCatalogPriceEntity known = latest.get(row.getModel());
                    if (known == null || row.getEffectiveFrom().isAfter(known.getEffectiveFrom())) {
                        latest.put(row.getModel(), row);
                    }
                }
                int added = 0;
                Instant now = Instant.now();
                for (AiProviderGateway.CatalogPrice price : prices) {
                    ModelCatalogPriceEntity known = latest.get(price.model());
                    if (known != null && !effectiveFrom.isAfter(known.getEffectiveFrom())) continue;
                    if (known != null && known.getInputPerMillion().compareTo(price.inputPerMillion()) == 0
                            && known.getOutputPerMillion().compareTo(price.outputPerMillion()) == 0) continue;
                    ModelCatalogPriceEntity row = new ModelCatalogPriceEntity();
                    row.setModel(price.model());
                    row.setModelKey(key(price.model()));
                    row.setInputPerMillion(price.inputPerMillion());
                    row.setOutputPerMillion(price.outputPerMillion());
                    row.setEffectiveFrom(effectiveFrom);
                    row.setSource(source);
                    row.setCreatedAt(now);
                    catalog.save(row);
                    added++;
                }
                return added;
            });
        } catch (DataIntegrityViolationException recordedByAnotherReplica) {
            return 0;
        }
    }

    private static String vendorOf(String model) {
        if (model == null) return null;
        int slash = model.indexOf('/');
        return slash > 0 ? model.substring(0, slash).toLowerCase(Locale.ROOT) : null;
    }

    private static String hostOf(String value) {
        try {
            String host = java.net.URI.create(value).getHost();
            return host == null ? "custom" : host;
        } catch (IllegalArgumentException invalid) {
            return "custom";
        }
    }
}
