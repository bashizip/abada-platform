import type { WorkflowEdge, WorkflowFile, WorkflowNode } from '@/types';
import { modelOrder } from '@/lib/layout/graphOrder';

export type LoopProblem = 'unbounded' | 'start' | 'join';

export interface LoopAnalysis {
  /** Edges that close a cycle (they return to an earlier step). */
  backEdges: WorkflowEdge[];
  /** Steps a cycle returns to, with what the engine would reject about them (null = bounded). */
  targets: Map<string, LoopProblem | null>;
}

/**
 * The loops of a diagram, judged by the rules the engine applies at
 * deployment (`LoopRules`): every cycle must return to a step that declares
 * `loop.max_iterations`, and never to the start or to a parallel/inclusive
 * gateway. Back-edges are the edges that point backwards in the same
 * depth-first model order the layout uses.
 */
export function analyzeLoops(workflow: Pick<WorkflowFile, 'nodes' | 'edges'>): LoopAnalysis {
  const position = new Map(modelOrder(workflow.nodes, workflow.edges).map((node, index) => [node.id, index]));
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const backEdges = workflow.edges.filter((edge) => {
    const source = position.get(edge.source);
    const target = position.get(edge.target);
    return source !== undefined && target !== undefined && target <= source;
  });
  const targets = new Map<string, LoopProblem | null>();
  for (const edge of backEdges) {
    const target = byId.get(edge.target);
    if (target) targets.set(target.id, problemOf(target));
  }
  return { backEdges, targets };
}

function problemOf(node: WorkflowNode): LoopProblem | null {
  if (node.type === 'event' && node.subtype === 'start') return 'start';
  if (node.type === 'gateway' && (node.subtype === 'parallel' || node.subtype === 'inclusive')) return 'join';
  return node.loop ? null : 'unbounded';
}

export function loopProblemMessage(problem: LoopProblem): string {
  switch (problem) {
    case 'unbounded': return 'A cycle returns to this step without a repeat limit; the engine will reject the deployment.';
    case 'start': return 'A cycle cannot return to the start; return to a task or a condition instead.';
    case 'join': return 'A cycle cannot return to a parallel or inclusive gateway; it would wait for a branch that never comes.';
  }
}
