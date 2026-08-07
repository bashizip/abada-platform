import dagre from 'dagre';
import { WorkflowNode, WorkflowEdge } from '@/types';

/**
 * Deterministic, readable graph layout for the Studio canvas.
 *
 * The graph is ranked left-to-right from the trigger(s) to the terminal
 * node(s): resting nodes on the same "rank" (longest-path distance from a
 * source) share a column, edges flow rightwards, and cycles are broken by
 * dagre's network-simplex ranker. Event/start sources stay on the left edge
 * and terminal nodes land on the right, so a workflow reads like a
 * left-to-right execution, matching the engine's token flow.
 */
export interface AutoLayoutOptions {
  /** Flow direction. Defaults to `LR` (left → right, execution order). */
  rankdir?: 'LR' | 'TB';
  /** Vertical gap between same-rank nodes (px). */
  nodesep?: number;
  /** Horizontal gap between ranks (px). */
  ranksep?: number;
}

const NODE_WIDTH = 224;
const NODE_HEIGHT = 128;

export function autoLayoutWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options: AutoLayoutOptions = {}
): WorkflowNode[] {
  if (nodes.length === 0) return nodes;

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: options.rankdir ?? 'LR',
    align: 'UL',
    nodesep: options.nodesep ?? 70,
    ranksep: options.ranksep ?? 110,
    ranker: 'network-simplex',
    marginx: 40,
    marginy: 40,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  // dagre positions are node centers; React Flow expects the top-left corner.
  return nodes.map((node) => {
    const placed = graph.node(node.id);
    if (!placed) return node;
    return {
      ...node,
      x: placed.x - NODE_WIDTH / 2,
      y: placed.y - NODE_HEIGHT / 2,
    };
  });
}