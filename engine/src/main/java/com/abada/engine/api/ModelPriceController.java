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

    public ModelPriceController(ModelPriceService prices, IdempotencyService idempotency) {
        this.prices = prices;
        this.idempotency = idempotency;
    }

    @GetMapping
    public List<PriceView> list() {
        return prices.list();
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
