package io.abada.worker;

import java.math.BigDecimal;

/** A model's price in USD per million tokens, as the engine serves it with agent work. */
public record ModelPrice(BigDecimal inputPerMillion, BigDecimal outputPerMillion) {
}
