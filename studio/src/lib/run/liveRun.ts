import { WorkflowFile } from '@/types';
import { ProcessInstanceDTO } from '@/api/engine';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Maps an engine instance status to the RunResult status union. */
export const mapTerminalStatus = (terminal: string): RunResult['status'] => {
  if (terminal === 'COMPLETED' || terminal === 'ACTIVE' || terminal === 'CANCELLED') {
    return terminal as RunResult['status'];
  }
  return 'FAILED';
};

/** A decision table that the engine actually applied in-transaction (proven by instance variables). */
export interface DecisionOutput {
  decisionKey: string;
  nodeId: string;
  nodeTitle: string;
  outputs: Record<string, unknown>;
}

export interface RunResult {
  instanceId: string;
  processDefinitionId: string;
  version: number;
  status: 'COMPLETED' | 'ACTIVE' | 'FAILED' | 'CANCELLED';
  /** Human task title the instance is waiting on (ACTIVE only). */
  waitingAt?: string;
  durationMs: number;
  decisionOutputs: DecisionOutput[];
  variables: Record<string, any>;
  error?: string;
}

/**
 * Placeholder defaults per DMN input type. They are chosen so the sample
 * workflows' first rules fire (EU high-value order, AML tiering, ...), which
 * makes a first live run immediately produce visible decision outputs.
 */
const DEFAULT_VALUE_BY_TYPE: Record<string, unknown> = {
  NUMBER: 14200,
  INTEGER: 5,
  PERCENT: 21,
  BOOLEAN: false,
  STRING: 'EU',
};

/** Parses `${order.jurisdiction}` into ['order', 'jurisdiction'], or null. */
const exprPath = (expr: string): string[] | null => {
  const match = expr.trim().match(/^\$\{([^}]+)\}$/);
  if (!match) return null;
  const path = match[1]
    .trim()
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  return path.length ? path : null;
};

const setPath = (obj: Record<string, any>, path: string[], value: unknown) => {
  let cursor = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[path[path.length - 1]] = value;
};

/**
 * Builds a starter input payload from the workflow's DMN input expressions,
 * e.g. `${order.jurisdiction}` + `${order.amountUSD}` → `{ order: { jurisdiction: "EU", amountUSD: 14200 } }`.
 */
export function deriveDefaultPayload(workflow: WorkflowFile): Record<string, any> {
  const payload: Record<string, any> = {};
  workflow.nodes.forEach((node) => {
    if (node.type !== 'dmn' || !node.dmnConfig) return;
    node.dmnConfig.inputs.forEach((input) => {
      if (!input.expr) return;
      const path = exprPath(input.expr);
      if (!path) return;
      const type = (input.type || 'STRING').toUpperCase();
      const value = type in DEFAULT_VALUE_BY_TYPE ? DEFAULT_VALUE_BY_TYPE[type] : 'EU';
      setPath(payload, path, value);
    });
  });
  return payload;
}

/**
 * Returns the decision tables whose declared outputs are present in the
 * instance variables — i.e. the tables the engine actually executed
 * in-transaction (the deterministic wall, proven by real data).
 */
export function extractDecisionOutputs(
  workflow: WorkflowFile,
  variables: Record<string, any>
): DecisionOutput[] {
  const results: DecisionOutput[] = [];
  workflow.nodes.forEach((node) => {
    if (node.type !== 'dmn' || !node.dmnConfig) return;
    const names = node.dmnConfig.outputs.map((o) => o.name).filter(Boolean);
    if (names.length === 0) return;
    if (!names.every((name) => name in variables)) return;
    results.push({
      decisionKey: node.dmnConfig.decisionKey,
      nodeId: node.id,
      nodeTitle: node.title,
      outputs: Object.fromEntries(names.map((name) => [name, variables[name]])),
    });
  });
  return results;
}

export type NodeRunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'waiting';

/**
 * Maps real engine state onto the canvas. Only engine-visible facts are used:
 * terminal status, decision outputs present in variables, and the human task
 * the instance is currently waiting on. Nothing is guessed.
 */
export function applyInstanceState(
  workflow: WorkflowFile,
  instance: ProcessInstanceDTO | null,
  waitingTaskName?: string
): Record<string, NodeRunStatus> {
  const statuses: Record<string, NodeRunStatus> = {};
  workflow.nodes.forEach((node) => (statuses[node.id] = 'idle'));

  if (!instance) return statuses;

  const terminal = instance.status.toUpperCase();
  const variables = instance.variables || {};

  if (terminal === 'COMPLETED') {
    workflow.nodes.forEach((node) => (statuses[node.id] = 'completed'));
    return statuses;
  }
  if (terminal === 'FAILED' || terminal === 'CANCELLED') {
    workflow.nodes.forEach((node) => (statuses[node.id] = 'failed'));
    return statuses;
  }

  workflow.nodes.forEach((node) => {
    if (node.type === 'event' && node.subtype === 'start') {
      statuses[node.id] = 'completed';
    } else if (node.type === 'dmn' && node.dmnConfig) {
      const names = node.dmnConfig.outputs.map((o) => o.name).filter(Boolean);
      if (names.length > 0 && names.every((name) => name in variables)) {
        statuses[node.id] = 'completed';
      }
    } else if (
      node.type === 'human' &&
      waitingTaskName &&
      (node.description || node.title) === waitingTaskName
    ) {
      statuses[node.id] = 'waiting';
    }
  });
  return statuses;
}
