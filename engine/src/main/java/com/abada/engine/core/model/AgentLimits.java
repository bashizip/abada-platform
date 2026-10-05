package com.abada.engine.core.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.io.Serializable;
import java.math.BigDecimal;

/**
 * Bounds of an agent's tool loop. {@code maxTurns} limits the model calls of
 * one attempt; {@code maxTokensTotal} and {@code budgetUsd} cap the whole task
 * across its attempts. Null means no limit. The worker stops early; the engine
 * refuses the journal step past a limit either way.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AgentLimits(Integer maxTurns, Long maxTokensTotal, BigDecimal budgetUsd) implements Serializable {
    public static final int DEFAULT_MAX_TURNS = 8;
    public static final int MAX_TURNS = 32;
    /** Applied only to agents that bind tools; single-call agents have no token cap unless declared. */
    public static final long DEFAULT_MAX_TOKENS_TOTAL = 50_000L;
}
