package com.abada.engine.api;

import com.abada.engine.core.IdempotencyService;
import com.abada.engine.llm.ModelPriceService;
import com.abada.engine.llm.ModelPriceService.PriceView;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Effective-dated model prices the engine prices agent calls with. Prices are
 * added, never edited; only a price that has not taken effect can be removed.
 */
@RestController
@RequestMapping("/v1/model-prices")
public class ModelPriceController {
    public record AddModelPriceRequest(String model, String provider, BigDecimal inputPerMillion,
            BigDecimal outputPerMillion, Instant effectiveFrom) {}

    private final ModelPriceService prices;
    private final IdempotencyService idempotency;
    private final com.abada.engine.llm.ModelCatalogService catalog;

    public ModelPriceController(ModelPriceService prices, IdempotencyService idempotency,
            com.abada.engine.llm.ModelCatalogService catalog) {
        this.prices = prices;
        this.idempotency = idempotency;
        this.catalog = catalog;
    }

    @GetMapping
    public List<PriceView> list() {
        return prices.list();
    }

    /** The price each model has now and where it comes from: ADMIN, CATALOG or NONE. */
    @GetMapping("/effective")
    public List<ModelPriceService.EffectivePrice> effective(
            @org.springframework.web.bind.annotation.RequestParam(name = "model", required = false)
            List<String> models) {
        return prices.effective(models == null ? List.of() : models);
    }

    /** The public price catalog: whether it is on, where it is read from and the last refresh. */
    @GetMapping("/catalog")
    public com.abada.engine.llm.ModelCatalogService.CatalogStatus catalogStatus() {
        return catalog.status();
    }

    /** Reads the public price catalog now. */
    @PostMapping("/catalog/refresh")
    public com.abada.engine.llm.ModelCatalogService.CatalogStatus refreshCatalog() {
        return catalog.refresh(true);
    }

    @PostMapping
    public PriceView add(@RequestBody AddModelPriceRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        if (request == null) {
            throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "A price body is required");
        }
        return idempotency.execute(idempotencyKey, "model-price.add", request,
                new com.fasterxml.jackson.core.type.TypeReference<PriceView>() {},
                () -> prices.add(request.model(), request.provider(), request.inputPerMillion(),
                        request.outputPerMillion(), request.effectiveFrom()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        idempotency.execute(idempotencyKey, "model-price.delete", Map.of("id", id), () -> {
            prices.deleteFuture(id);
            return Map.of("status", "Deleted", "id", id);
        });
        return ResponseEntity.noContent().build();
    }
}
