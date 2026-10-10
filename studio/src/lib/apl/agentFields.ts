import type { AgentDelegate, CallProcessConfig } from '@/types';

const PROCESS_KEY = /^[a-z][a-z0-9_-]{0,127}$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The loop limits of an agent node (E8). */
export interface AgentLimits {
  maxTurns?: number;
  maxTokensTotal?: number;
  budgetUsd?: number;
}

/** Why the engine would refuse the limits, or null. */
export function limitsProblem(limits: AgentLimits): string | null {
  if (limits.maxTurns !== undefined && (!Number.isInteger(limits.maxTurns) || limits.maxTurns < 1 || limits.maxTurns > 32)) {
    return 'Max turns is a whole number from 1 to 32.';
  }
  if (limits.maxTokensTotal !== undefined && (!Number.isInteger(limits.maxTokensTotal) || limits.maxTokensTotal < 1)) {
    return 'Max tokens is a whole number of at least 1.';
  }
  if (limits.budgetUsd !== undefined && !(limits.budgetUsd > 0)) return 'The budget must be more than $0.';
  return null;
}

/** Why the engine would refuse the delegates, or null. */
export function delegatesProblem(delegates: AgentDelegate[]): string | null {
  if (delegates.length > 8) return 'An agent may delegate to at most 8 processes.';
  const seen = new Set<string>();
  for (const delegate of delegates) {
    if (!PROCESS_KEY.test(delegate.process)) return `"${delegate.process}" is not a process key.`;
    if (seen.has(delegate.process)) return `"${delegate.process}" is listed twice.`;
    seen.add(delegate.process);
    if (!delegate.outputs?.length) return `Name what "${delegate.process}" returns to the agent (outputs).`;
    const bad = delegate.outputs.find((output) => !VARIABLE.test(output));
    if (bad) return `"${bad}" is not a variable name.`;
    if (delegate.approval === 'required' && !delegate.approvers?.length) {
      return `Name who approves delegating to "${delegate.process}".`;
    }
  }
  return null;
}

/** Why the engine would refuse the call, or null. */
export function callProcessProblem(config: CallProcessConfig): string | null {
  if (!PROCESS_KEY.test(config.process ?? '')) return 'Name the process to call by its key.';
  const inputs = Object.keys(config.inputs ?? {});
  const badInput = inputs.find((name) => !VARIABLE.test(name));
  if (badInput) return `"${badInput}" is not a variable name.`;
  const outputs = Object.entries(config.outputs ?? {});
  if (outputs.length === 0) return 'Map at least one output back (parent variable ← child variable).';
  const badOutput = outputs.find(([parent, child]) => !VARIABLE.test(parent) || !VARIABLE.test(child));
  if (badOutput) return `"${badOutput[0]} ← ${badOutput[1]}" must map variable names.`;
  if (config.maxDepth !== undefined && (!Number.isInteger(config.maxDepth) || config.maxDepth < 1 || config.maxDepth > 10)) {
    return 'Max depth is a whole number from 1 to 10.';
  }
  return null;
}
