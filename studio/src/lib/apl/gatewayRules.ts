import type { WorkflowEdge, WorkflowFile } from '@/types';
import { isOutcomeRouteEdge } from '@/lib/apl/routes';

/**
 * Branch rules of a condition / inclusive gateway. Each outgoing edge is one
 * rule: its `condition` field holds the CEL expression saved as the rule's
 * `if`, and its label is what the canvas shows (`if <cel>` or `else`). Editing
 * goes through these helpers so the two never drift apart.
 */

/**
 * The expression saved as the rule's `if`. Free-text labels are descriptions
 * and never become conditions; only a `${…}` label written before conditions
 * were carried on the edge is still recognised.
 */
export function edgeCondition(edge: Pick<WorkflowEdge, 'label' | 'condition'>): string | undefined {
  if (edge.condition?.trim()) return edge.condition.trim();
  const raw = edge.label?.replace(/^if\s+/i, '').trim();
  if (raw && /^\$\{.*\}$/.test(raw)) return raw;
  return undefined;
}

/** Whether the branch is saved as the `else` rule (mirrors workflowToAPL). */
export function isElseBranch(edge: WorkflowEdge, index: number, branches: WorkflowEdge[]): boolean {
  if (edgeCondition(edge)) return false;
  return !!edge.label?.toLowerCase().includes('else') || index === branches.length - 1;
}

/** The outgoing edges that are rules of the gateway, in rule order. */
export const gatewayBranches = (wf: WorkflowFile, gatewayId: string): WorkflowEdge[] =>
  wf.edges.filter((edge) => edge.source === gatewayId && !isOutcomeRouteEdge(edge));

const updateEdge = (wf: WorkflowFile, edgeId: string, patch: (edge: WorkflowEdge) => WorkflowEdge): WorkflowFile => ({
  ...wf,
  edges: wf.edges.map((edge) => (edge.id === edgeId ? patch(edge) : edge)),
});

const withoutCondition = (edge: WorkflowEdge, label: string): WorkflowEdge => {
  const next = { ...edge, label };
  delete next.condition;
  return next;
};

/** Sets a branch's condition; an empty one leaves the branch without a rule. */
export const setBranchCondition = (wf: WorkflowFile, edgeId: string, condition: string): WorkflowFile =>
  updateEdge(wf, edgeId, (edge) => (condition.trim()
    ? { ...edge, condition, label: `if ${condition.trim()}` }
    : withoutCondition(edge, '')));

/** Marks a branch as the `else` rule (dropping its condition), or unmarks it. */
export const setBranchElse = (wf: WorkflowFile, edgeId: string, isElse: boolean): WorkflowFile =>
  updateEdge(wf, edgeId, (edge) => withoutCondition(edge, isElse ? 'else' : ''));

/**
 * What the engine would reject about one branch, or null: every rule needs an
 * `if` except a single `else` (the last branch without a condition becomes it).
 */
export function branchProblem(edge: WorkflowEdge, index: number, branches: WorkflowEdge[]): string | null {
  if (branches.length < 2) return null;
  if (!isElseBranch(edge, index, branches)) {
    return edgeCondition(edge) ? null : 'Needs a condition, or mark it as the else branch.';
  }
  const earlierElse = branches.slice(0, index).some((other, i) => isElseBranch(other, i, branches));
  return earlierElse ? 'Only one branch can be the else branch; give this one a condition.' : null;
}
