package com.abada.engine.llm;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.core.model.ModelPrice;
import com.abada.engine.persistence.entity.ModelPriceEntity;
import com.abada.engine.persistence.repository.ModelPriceRepository;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Effective-dated model prices (USD per million tokens) and the cost the
 * engine computes from them. Cost is always computed here, from token counts
 * and the price in effect at the time of the call, never taken from a worker.
 * A call with tokens but no price is "unpriced": its cost is unknown, never 0.
 */
@Service
public class ModelPriceService {
    private static final BigDecimal MILLION = BigDecimal.valueOf(1_000_000L);

    /**
     * The cost of one call: {@code usd} null when the call reported no tokens
     * (nothing to price) or no price applied ({@code unpriced}).
     */
    public record Cost(BigDecimal usd, boolean unpriced) {
        public static final Cost NONE = new Cost(null, false);
        public static final Cost UNPRICED = new Cost(null, true);
    }

    public record PriceView(String id, String model, String provider, BigDecimal inputPerMillion,
            BigDecimal outputPerMillion, Instant effectiveFrom, String createdBy, Instant createdAt) {
        static PriceView from(ModelPriceEntity row) {
            return new PriceView(row.getId(), row.getModel(), row.getProvider(), row.getInputPerMillion(),
                    row.getOutputPerMillion(), row.getEffectiveFrom(), row.getCreatedBy(), row.getCreatedAt());
        }
    }

    private final ModelPriceRepository prices;
    private final AiProviderRegistry providers;
    private final ActivityHistoryService history;

    public ModelPriceService(ModelPriceRepository prices, @Autowired(required = false) AiProviderRegistry providers,
            ActivityHistoryService history) {
        this.prices = prices;
        this.providers = providers;
        this.history = history;
    }

    @Transactional(readOnly = true)
    public List<PriceView> list() {
        return prices.findAllByOrderByModelAscEffectiveFromDesc().stream().map(PriceView::from).toList();
    }

    /** Adds a price from {@code effectiveFrom} (now when null). Costs already computed never change. */
    @Transactional
    public PriceView add(String model, String provider, BigDecimal inputPerMillion, BigDecimal outputPerMillion,
            Instant effectiveFrom) {
        if (model == null || model.isBlank() || model.length() > 255) throw invalid("model is required");
        if (inputPerMillion == null || outputPerMillion == null || inputPerMillion.signum() < 0
                || outputPerMillion.signum() < 0) {
            throw invalid("inputPerMillion and outputPerMillion are required and not negative");
        }
        ModelPriceEntity row = new ModelPriceEntity();
        row.setModel(model.strip());
        row.setProvider(provider == null || provider.isBlank() ? null : provider.strip());
        row.setInputPerMillion(inputPerMillion);
        row.setOutputPerMillion(outputPerMillion);
        row.setEffectiveFrom(effectiveFrom == null ? Instant.now() : effectiveFrom);
        row.setCreatedBy(IdentityContext.get().map(Identity::username).orElse("system"));
        row.setCreatedAt(Instant.now());
        prices.save(row);
        history.record("MODEL_PRICE_ADDED", null, null, null, Map.of("model", row.getModel(),
                "provider", row.getProvider() == null ? "" : row.getProvider(),
                "effectiveFrom", row.getEffectiveFrom().toString()));
        return PriceView.from(row);
    }

    /** Removes a price that has not taken effect yet; a price that applied is part of the audit trail. */
    @Transactional
    public void deleteFuture(String id) {
        ModelPriceEntity row = prices.findById(id).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,
                ApiErrorCode.RESOURCE_NOT_FOUND, "Model price not found"));
        if (!row.getEffectiveFrom().isAfter(Instant.now())) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "This price already took effect; add a new price instead");
        }
        prices.delete(row);
        history.record("MODEL_PRICE_DELETED", null, null, null,
                Map.of("model", row.getModel(), "effectiveFrom", row.getEffectiveFrom().toString()));
    }

    /**
     * The price in effect for a model at a time: the latest one effective at
     * or before {@code at}, preferring one for the provider that serves the
     * model over a provider-less one.
     */
    @Transactional(readOnly = true)
    public Optional<ModelPrice> priceAt(String model, Instant at) {
        if (model == null || model.isBlank()) return Optional.empty();
        String provider = providers == null ? null
                : providers.resolveForModel(model).map(ResolvedAiProvider::id).orElse(null);
        ModelPriceEntity generic = null;
        for (ModelPriceEntity row : prices.findByModelOrderByEffectiveFromDesc(model.strip())) {
            if (row.getEffectiveFrom().isAfter(at)) continue;
            if (row.getProvider() != null && row.getProvider().equals(provider)) {
                return Optional.of(new ModelPrice(row.getInputPerMillion(), row.getOutputPerMillion()));
            }
            if (row.getProvider() == null && generic == null) generic = row;
        }
        return Optional.ofNullable(generic)
                .map(row -> new ModelPrice(row.getInputPerMillion(), row.getOutputPerMillion()));
    }

    /** The cost of a call with these token counts at {@code at}. */
    public Cost cost(String model, Integer promptTokens, Integer completionTokens, Instant at) {
        if (promptTokens == null && completionTokens == null) return Cost.NONE;
        Optional<ModelPrice> price = priceAt(model, at);
        if (price.isEmpty()) return Cost.UNPRICED;
        BigDecimal usd = price.get().inputPerMillion().multiply(BigDecimal.valueOf(promptTokens == null ? 0 : promptTokens))
                .add(price.get().outputPerMillion().multiply(
                        BigDecimal.valueOf(completionTokens == null ? 0 : completionTokens)))
                .divide(MILLION, 8, RoundingMode.HALF_UP);
        return new Cost(usd, false);
    }

    /** Current prices of these models, for the agent descriptor (models without a price are left out). */
    public Map<String, ModelPrice> currentPrices(Collection<String> models) {
        Map<String, ModelPrice> current = new LinkedHashMap<>();
        Instant now = Instant.now();
        for (String model : models) {
            if (model == null || model.isBlank()) continue;
            priceAt(model, now).ifPresent(price -> current.put(model, price));
        }
        return current;
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, message);
    }
}
