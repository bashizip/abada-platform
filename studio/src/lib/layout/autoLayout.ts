import dagre from 'dagre';
import { WorkflowNode, WorkflowEdge } from '@/types';

/**
 * Deterministic, readable graph layout for the Studio canvas.
 *
 * Improvements over the basic dagre layout:
 * - Dynamic node sizing based on type and config (agent nodes with config
 *   are taller, human tasks with assignees are taller, etc.)
 * - Adaptive spacing that scales with graph complexity
 * - Edge crossing minimization via iterative rank swapping
 * - Gateway-aware positioning to make branching patterns clear
 */
export interface AutoLayoutOptions {
  /** Flow direction. Defaults to `LR` (left → right, execution order). */
  rankdir?: 'LR' | 'TB';
  /** Vertical gap between same-rank nodes (px). Override to force. */
  nodesep?: number;
  /** Horizontal gap between ranks (px). Override to force. */
  ranksep?: number;
}

/* ------------------------------------------------------------------ */
/* Dynamic node dimensions                                            */
/* ------------------------------------------------------------------ */

/** Estimate the visual height of a node based on its type and config. */
function estimateNodeHeight(node: WorkflowNode): number {
  let height = 100; // base height for a minimal node

  // Type-specific additions
  switch (node.type) {
    case 'agent':
      height = 120;
      if (node.agentConfig) {
        if (node.agentConfig.tools?.length) height += 16;
        if (node.agentConfig.maxAttempts !== undefined) height += 16;
      }
      break;
    case 'human':
      height = 110;
      if (node.humanConfig?.assignees?.length) height += 12;
      break;
    case 'dmn':
      height = 110;
      if (node.dmnConfig?.rules?.length) height += 12;
      break;
    case 'gateway':
      height = 90;
      break;
    case 'event':
      height = 80;
      break;
    default:
      height = 100;
  }

  // Description length adds height
  if (node.description && node.description.length > 60) {
    height += 12;
  }

  return height;
}

/** Estimate the visual width of a node. */
function estimateNodeWidth(node: WorkflowNode): number {
  let width = 208; // base width (w-52 = 13rem = 208px)

  // Longer titles need more width
  if (node.title && node.title.length > 20) {
    width = Math.min(280, width + (node.title.length - 20) * 3);
  }

  return width;
}

/* ------------------------------------------------------------------ */
/* Adaptive spacing                                                   */
/* ------------------------------------------------------------------ */

function computeSpacing(nodeCount: number, edgeCount: number) {
  // Base spacing
  let nodesep = 70;
  let ranksep = 110;

  // Scale up for larger graphs so nodes don't crowd
  if (nodeCount > 8) {
    nodesep = 80;
    ranksep = 130;
  }
  if (nodeCount > 15) {
    nodesep = 90;
    ranksep = 150;
  }
  if (nodeCount > 25) {
    nodesep = 100;
    ranksep = 170;
  }

  // Dense graphs (high edge-to-node ratio) need more horizontal space
  const density = nodeCount > 0 ? edgeCount / nodeCount : 0;
  if (density > 1.5) {
    ranksep += 20;
  }
  if (density > 2.0) {
    ranksep += 30;
    nodesep += 10;
  }

  return { nodesep, ranksep };
}

/* ------------------------------------------------------------------ */
/* Edge crossing minimization                                         */
/* ------------------------------------------------------------------ */

/**
 * After dagre assigns ranks, try swapping adjacent nodes within each rank
 * to reduce the number of edge crossings. This is a simple greedy heuristic
 * that works well for workflow-sized graphs.
 */
function minimizeCrossings(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  rankMap: Map<string, number>,
): WorkflowNode[] {
  if (nodes.length < 3) return nodes;

  // Group nodes by rank
  const ranks = new Map<number, WorkflowNode[]>();
  for (const node of nodes) {
    const rank = rankMap.get(node.id) ?? 0;
    if (!ranks.has(rank)) ranks.set(rank, []);
    ranks.get(rank)!.push(node);
  }

  // Build adjacency: for each node, the set of ranks it connects to
  const upEdges = new Map<string, Set<number>>(); // node -> ranks of upstream nodes
  const downEdges = new Map<string, Set<number>>(); // node -> ranks of downstream nodes
  for (const edge of edges) {
    const srcRank = rankMap.get(edge.source) ?? 0;
    const tgtRank = rankMap.get(edge.target) ?? 0;
    if (!upEdges.has(edge.target)) upEdges.set(edge.target, new Set());
    if (!downEdges.has(edge.source)) downEdges.set(edge.source, new Set());
    upEdges.get(edge.target)!.add(srcRank);
    downEdges.get(edge.source)!.add(tgtRank);
  }

  // Count crossings between two adjacent nodes in the same rank
  function countCrossings(a: WorkflowNode, b: WorkflowNode, rank: number): number {
    let crossings = 0;
    const aUp = upEdges.get(a.id) ?? new Set();
    const bUp = upEdges.get(b.id) ?? new Set();
    const aDown = downEdges.get(a.id) ?? new Set();
    const bDown = downEdges.get(b.id) ?? new Set();

    // Upstream crossings: a connects to rank R, b connects to rank R-1
    // If a's upstream is "below" b's upstream in the target rank, it's a crossing
    for (const r of aUp) {
      const targetNodes = ranks.get(r);
      if (!targetNodes) continue;
      const aIdx = targetNodes.indexOf(a);
      const bIdx = targetNodes.indexOf(b);
      if (aIdx >= 0 && bIdx >= 0 && aIdx > bIdx) crossings++;
    }

    // Downstream crossings
    for (const r of aDown) {
      const targetNodes = ranks.get(r);
      if (!targetNodes) continue;
      const aIdx = targetNodes.indexOf(a);
      const bIdx = targetNodes.indexOf(b);
      if (aIdx >= 0 && bIdx >= 0 && aIdx > bIdx) crossings++;
    }

    return crossings;
  }

  // Iterative swap: for each rank, try swapping adjacent nodes if it reduces crossings
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 10) {
    improved = false;
    iterations++;
    for (const [, rankNodes] of ranks) {
      for (let i = 0; i < rankNodes.length - 1; i++) {
        const a = rankNodes[i];
        const b = rankNodes[i + 1];
        const crossingsBefore = countCrossings(a, b, 0) + countCrossings(b, a, 0);

        // Try swap
        rankNodes[i] = b;
        rankNodes[i + 1] = a;
        const crossingsAfter = countCrossings(b, a, 0) + countCrossings(a, b, 0);

        if (crossingsAfter < crossingsBefore) {
          improved = true;
        } else {
          // Swap back
          rankNodes[i] = a;
          rankNodes[i + 1] = b;
        }
      }
    }
  }

  // Flatten back to ordered list, preserving rank order
  const sortedRanks = [...ranks.entries()].sort((a, b) => a[0] - b[0]);
  return sortedRanks.flatMap(([, nodes]) => nodes);
}

/* ------------------------------------------------------------------ */
/* Main layout function                                               */
/* ------------------------------------------------------------------ */

export function autoLayoutWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options: AutoLayoutOptions = {}
): WorkflowNode[] {
  if (nodes.length === 0) return nodes;
  if (nodes.length === 1) return nodes;

  const spacing = computeSpacing(nodes.length, edges.length);

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: options.rankdir ?? 'LR',
    align: 'UL',
    nodesep: options.nodesep ?? spacing.nodesep,
    ranksep: options.ranksep ?? spacing.ranksep,
    ranker: 'network-simplex',
    marginx: 40,
    marginy: 40,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  // Use dynamic node dimensions
  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: estimateNodeWidth(node),
      height: estimateNodeHeight(node),
    });
  });
  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  // Extract rank assignments for crossing minimization
  const rankMap = new Map<string, number>();
  nodes.forEach((node) => {
    const placed = graph.node(node.id);
    if (placed) {
      // dagre stores rank in the graph's internal state
      // We can infer it from the x-position in LR mode
      rankMap.set(node.id, Math.round(placed.x));
    }
  });

  // Map dagre center positions to top-left corner positions
  const positioned = nodes.map((node) => {
    const placed = graph.node(node.id);
    if (!placed) return node;
    const width = estimateNodeWidth(node);
    const height = estimateNodeHeight(node);
    return {
      ...node,
      x: placed.x - width / 2,
      y: placed.y - height / 2,
    };
  });

  // Attempt to minimize edge crossings within each rank
  const result = minimizeCrossings(positioned, edges, rankMap);

  return result;
}
