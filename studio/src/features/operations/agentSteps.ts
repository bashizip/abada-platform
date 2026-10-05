import type { AgentStepEvidence } from '@/api/evidence';

/** Totals of a set of steps: engine-computed cost, tokens, and whether some model had no price. */
export function stepTotals(steps: AgentStepEvidence[]) {
  return {
    usd: steps.reduce((sum, step) => sum + (step.costUsd ?? 0), 0),
    tokens: steps.reduce((sum, step) => sum + (step.promptTokens ?? 0) + (step.completionTokens ?? 0), 0),
    unpriced: steps.some((step) => step.costUnpriced),
  };
}
