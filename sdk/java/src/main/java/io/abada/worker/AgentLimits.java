package io.abada.worker;

import java.math.BigDecimal;

/**
 * Bounds of an agent's tool loop: {@code maxTurns} model calls per attempt;
 * {@code maxTokensTotal} and {@code budgetUsd} for the whole task across its
 * attempts. Null means no limit. The engine refuses a journal step past a
 * limit; a worker stops early and reports {@code AGENT_BUDGET_EXHAUSTED}.
 */
public record AgentLimits(Integer maxTurns, Long maxTokensTotal, BigDecimal budgetUsd) {
}
