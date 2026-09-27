import type { WorkflowEdge, WorkflowNode } from '@/types';
import { edgeKindOf, isOutcomeKind } from './edgeGeometry';

/**
 * Deterministic model order: reverse post-order of a depth-first walk from
 * the start event(s), following sequence flows before outcome routes and
 * branches in authoring order. In this order every non-loop edge points
 * forward, so ELK's MODEL_ORDER cycle breaker reverses exactly the loops.
 */
export function modelOrder(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const successors = new Map<string, string[]>();
  const incoming = new Set<string>();
  const ordered = [
    ...edges.filter((edge) => !isOutcomeKind(edgeKindOf(edge))),
    ...edges.filter((edge) => isOutcomeKind(edgeKindOf(edge))),
  ];
  for (const edge of ordered) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const list = successors.get(edge.source) ?? [];
    list.push(edge.target);
    successors.set(edge.source, list);
    if (edge.source !== edge.target) incoming.add(edge.target);
  }

  const starts = nodes.filter((node) => node.type === 'event' && node.subtype === 'start');
  const roots = [
    ...starts,
    ...nodes.filter((node) => !incoming.has(node.id) && !starts.includes(node)),
  ];

  const visited = new Set<string>();
  const postOrder: string[] = [];
  const visit = (id: string) => {
    visited.add(id);
    // Children are walked last-first so the reversed post-order lists them first-first.
    const next = successors.get(id) ?? [];
    for (let i = next.length - 1; i >= 0; i--) {
      if (!visited.has(next[i])) visit(next[i]);
    }
    postOrder.push(id);
  };
  // Nodes unreachable from any root (isolated cycles) are walked first so
  // they land after the main flow.
  const reachable = reachableFrom(roots.map((root) => root.id), successors);
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (!reachable.has(nodes[i].id) && !visited.has(nodes[i].id)) visit(nodes[i].id);
  }
  for (let i = roots.length - 1; i >= 0; i--) {
    if (!visited.has(roots[i].id)) visit(roots[i].id);
  }
  return postOrder.reverse().map((id) => byId.get(id)!);
}

function reachableFrom(roots: string[], successors: Map<string, string[]>): Set<string> {
  const seen = new Set<string>(roots);
  const stack = [...roots];
  while (stack.length) {
    for (const next of successors.get(stack.pop()!) ?? []) {
      if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return seen;
}

/**
 * Layer index of each node: the longest path to it from a root, over the
 * edges that point forward in model order (loops are ignored).
 */
export function layerIndex(order: WorkflowNode[], edges: WorkflowEdge[]): Map<string, number> {
  const position = new Map(order.map((node, index) => [node.id, index]));
  const layer = new Map(order.map((node) => [node.id, 0]));
  const forward = edges.filter((edge) => {
    const s = position.get(edge.source);
    const t = position.get(edge.target);
    return s !== undefined && t !== undefined && s < t;
  });
  for (const node of order) {
    for (const edge of forward) {
      if (edge.source !== node.id) continue;
      layer.set(edge.target, Math.max(layer.get(edge.target)!, layer.get(node.id)! + 1));
    }
  }
  return layer;
}
