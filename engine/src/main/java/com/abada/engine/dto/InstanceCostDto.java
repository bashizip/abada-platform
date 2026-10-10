package com.abada.engine.dto;

import java.math.BigDecimal;

/**
 * What an instance's agent calls cost, computed by the engine from token
 * counts and model prices. {@code usd} sums the priced calls; when
 * {@code includesUnpriced} is true some calls had no price and the real cost
 * is higher.
 */
public record InstanceCostDto(BigDecimal usd, long promptTokens, long completionTokens, boolean includesUnpriced) {
}
