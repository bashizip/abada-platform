package com.abada.engine.core.model;

import java.io.Serializable;
import java.math.BigDecimal;

/** A model's price in USD per million tokens. */
public record ModelPrice(BigDecimal inputPerMillion, BigDecimal outputPerMillion) implements Serializable {
}
