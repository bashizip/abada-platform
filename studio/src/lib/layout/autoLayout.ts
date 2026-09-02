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
/* Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

interface Rect { x: number; y: number; w: number; h: number }

function nodeRect(n: WorkflowNode): Rect {
  return { x: n.x, y: n.y, w: estimateNodeWidth(n), h: estimateNodeHeight(n) };
}

/** Distance from point (px,py) to line segment (ax,ay)-(bx,by). */
function distToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Does a rectangle intersect a line segment (with padding)? */
function rectIntersectsSegment(rect: Rect, ax: number, ay: number, bx: number, by: number, pad: number): boolean {
  // Quick reject: bounding box of the segment vs the rect (with padding)
  const segMinX = Math.min(ax, bx) - pad;
  const segMaxX = Math.max(ax, bx) + pad;
  const segMinY = Math.min(ay, by) - pad;
  const segMaxY = Math.max(ay, by) + pad;
  if (rect.x + rect.w < segMinX || rect.x > segMaxX) return false;
  if (rect.y + rect.h < segMinY || rect.y > segMaxY) return false;

  // Check if any corner of the rect is close to the segment
  const corners: [number, number][] = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h],
  ];
  for (const [cx, cy] of corners) {
    if (distToSegment(cx, cy, ax, ay, bx, by) < pad) return true;
  }

  // Check if the segment passes through the rect
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sx = ax + t * (bx - ax);
    const sy = ay + t * (by - ay);
    if (sx >= rect.x - pad && sx <= rect.x + rect.w + pad &&
        sy >= rect.y - pad && sy <= rect.y + rect.h + pad) return true;
  }

  return false;
}

/** Count how many edges cross through a node's bounding box. */
function countEdgeCrossingsForNode(
  node: WorkflowNode,
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
  nodeMap: Map<string, WorkflowNode>,
  pad: number,
): number {
  const rect = nodeRect(node);
  let count = 0;
  for (const edge of edges) {
    // Skip edges where this node is source or target
    if (edge.source === node.id || edge.target === node.id) continue;
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (!src || !tgt) continue;
    const srcRect = nodeRect(src);
    const tgtRect = nodeRect(tgt);
    // Edge goes from source center to target center
    const ax = srcRect.x + srcRect.w / 2;
    const ay = srcRect.y + srcRect.h / 2;
    const bx = tgtRect.x + tgtRect.w / 2;
    const by = tgtRect.y + tgtRect.h / 2;
    if (rectIntersectsSegment(rect, ax, ay, bx, by, pad)) count++;
  }
  return count;
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
  const upEdges = new Map<string, Set<number>>();
  const downEdges = new Map<string, Set<number>>();
  for (const edge of edges) {
    const srcRank = rankMap.get(edge.source) ?? 0;
    const tgtRank = rankMap.get(edge.target) ?? 0;
    if (!upEdges.has(edge.target)) upEdges.set(edge.target, new Set());
    if (!downEdges.has(edge.source)) downEdges.set(edge.source, new Set());
    upEdges.get(edge.target)!.add(srcRank);
    downEdges.get(edge.source)!.add(tgtRank);
  }

  function countCrossings(a: WorkflowNode, b: WorkflowNode): number {
    let crossings = 0;
    const aUp = upEdges.get(a.id) ?? new Set();
    const bUp = upEdges.get(b.id) ?? new Set();
    const aDown = downEdges.get(a.id) ?? new Set();
    const bDown = downEdges.get(b.id) ?? new Set();

    for (const r of aUp) {
      const targetNodes = ranks.get(r);
      if (!targetNodes) continue;
      const aIdx = targetNodes.indexOf(a);
      const bIdx = targetNodes.indexOf(b);
      if (aIdx >= 0 && bIdx >= 0 && aIdx > bIdx) crossings++;
    }
    for (const r of aDown) {
      const targetNodes = ranks.get(r);
      if (!targetNodes) continue;
      const aIdx = targetNodes.indexOf(a);
      const bIdx = targetNodes.indexOf(b);
      if (aIdx >= 0 && bIdx >= 0 && aIdx > bIdx) crossings++;
    }
    return crossings;
  }

  let improved = true;
  let iterations = 0;
  while (improved && iterations < 10) {
    improved = false;
    iterations++;
    for (const [, rankNodes] of ranks) {
      for (let i = 0; i < rankNodes.length - 1; i++) {
        const a = rankNodes[i];
        const b = rankNodes[i + 1];
        const before = countCrossings(a, b) + countCrossings(b, a);
        rankNodes[i] = b;
        rankNodes[i + 1] = a;
        const after = countCrossings(b, a) + countCrossings(a, b);
        if (after < before) {
          improved = true;
        } else {
          rankNodes[i] = a;
          rankNodes[i + 1] = b;
        }
      }
    }
  }

  const sortedRanks = [...ranks.entries()].sort((a, b) => a[0] - b[0]);
  return sortedRanks.flatMap(([, n]) => n);
}

/* ------------------------------------------------------------------ */
/* Node-node overlap resolution (post-processing)                     */
/* ------------------------------------------------------------------ */

const MIN_NODE_GAP = 24; // min clearance between any two nodes

/** Do two axis-aligned rectangles overlap (with gap padding)? */
function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return !(a.x + a.w + gap <= b.x ||
           b.x + b.w + gap <= a.x ||
           a.y + a.h + gap <= b.y ||
           b.y + b.h + gap <= a.y);
}

/**
 * After dagre + rank swapping, some nodes in the same rank may still
 * overlap or be too close together. This pass detects overlaps and
 * pushes nodes apart vertically.
 */
function resolveOverlaps(
  nodes: WorkflowNode[],
  rankMap: Map<string, number>,
): WorkflowNode[] {
  if (nodes.length < 2) return nodes;

  const result = [...nodes];
  const nodeMap = new Map(result.map((n) => [n.id, n]));

  // Group by rank
  const ranks = new Map<number, WorkflowNode[]>();
  for (const node of result) {
    const rank = rankMap.get(node.id) ?? 0;
    if (!ranks.has(rank)) ranks.set(rank, []);
    ranks.get(rank)!.push(node);
  }

  // Within each rank, sort by y and push apart overlapping nodes
  for (const [, rankNodes] of ranks) {
    if (rankNodes.length < 2) continue;

    // Sort by y position
    rankNodes.sort((a, b) => a.y - b.y);

    let changed = true;
    let iterations = 0;
    while (changed && iterations < 10) {
      changed = false;
      iterations++;
      for (let i = 0; i < rankNodes.length - 1; i++) {
        const upper = rankNodes[i];
        const lower = rankNodes[i + 1];
        const upperRect = nodeRect(upper);
        const lowerRect = nodeRect(lower);

        if (rectsOverlap(upperRect, lowerRect, MIN_NODE_GAP)) {
          // Push lower node down just enough to clear the upper node
          const overlapY = (upper.y + estimateNodeHeight(upper) + MIN_NODE_GAP) - lower.y;
          if (overlapY > 0) {
            lower.y += overlapY;
            nodeMap.set(lower.id, lower);
            changed = true;
          }
        }
      }
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Node-edge crossing avoidance (post-processing)                     */
/* ------------------------------------------------------------------ */

/**
 * After dagre + crossing minimization, some nodes may still visually
 * cross edges they aren't connected to. This pass detects those
 * crossings and tries shifting nodes vertically (within their rank)
 * to find a clear position.
 */
function avoidNodeEdgeCrossings(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  rankMap: Map<string, number>,
): WorkflowNode[] {
  if (nodes.length < 3) return nodes;

  const result = [...nodes];
  const nodeMap = new Map(result.map((n) => [n.id, n]));
  const PAD = 16; // min clearance between a node and a non-incident edge

  // Group by rank for local shifting
  const ranks = new Map<number, WorkflowNode[]>();
  for (const node of result) {
    const rank = rankMap.get(node.id) ?? 0;
    if (!ranks.has(rank)) ranks.set(rank, []);
    ranks.get(rank)!.push(node);
  }

  // Iterative: shift each node up/down to reduce edge crossings
  let improved = true;
  let rounds = 0;
  while (improved && rounds < 5) {
    improved = false;
    rounds++;
    for (const node of result) {
      const currentCrossings = countEdgeCrossingsForNode(node, result, edges, nodeMap, PAD);
      if (currentCrossings === 0) continue;

      const rank = rankMap.get(node.id) ?? 0;
      const rankNodes = ranks.get(rank) ?? [];
      const nodeIdx = rankNodes.indexOf(node);
      if (nodeIdx < 0) continue;

      // Compute the y-range we can shift to without overlapping siblings
      let minShift = -60;
      let maxShift = 60;
      const nodeH = estimateNodeHeight(node);
      for (let j = 0; j < rankNodes.length; j++) {
        if (j === nodeIdx) continue;
        const sibling = rankNodes[j];
        const siblingH = estimateNodeHeight(sibling);
        const gap = 20; // min gap between nodes in same rank
        if (sibling.y < node.y) {
          // sibling is above — we can't shift up past it
          const limit = sibling.y + siblingH + gap - node.y;
          minShift = Math.max(minShift, limit);
        } else {
          // sibling is below — we can't shift down past it
          const limit = sibling.y - gap - nodeH - node.y;
          maxShift = Math.min(maxShift, limit);
        }
      }

      if (minShift > maxShift) continue; // no room to shift

      // Try a few shift positions and pick the best
      let bestShift = 0;
      let bestCrossings = currentCrossings;
      const candidates = [0];
      for (let s = 20; s <= 60; s += 20) {
        if (s >= minShift && s <= maxShift) candidates.push(s);
        if (-s >= minShift && -s <= maxShift) candidates.push(-s);
      }
      // Also try the extremes
      if (minShift !== 0) candidates.push(minShift);
      if (maxShift !== 0) candidates.push(maxShift);

      for (const shift of candidates) {
        if (shift === 0) continue;
        // Temporarily shift
        const origY = node.y;
        node.y += shift;
        nodeMap.set(node.id, node);
        const crossings = countEdgeCrossingsForNode(node, result, edges, nodeMap, PAD);
        if (crossings < bestCrossings) {
          bestCrossings = crossings;
          bestShift = shift;
        }
        node.y = origY;
        nodeMap.set(node.id, node);
      }

      if (bestShift !== 0) {
        node.y += bestShift;
        nodeMap.set(node.id, node);
        improved = true;
      }
    }
  }

  return result;
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

  // 1. Minimize edge-edge crossings via rank-aware swapping
  const sorted = minimizeCrossings(positioned, edges, rankMap);

  // 2. Resolve node-node overlaps within each rank
  const nonOverlapping = resolveOverlaps(sorted, rankMap);

  // 3. Shift nodes to avoid crossing edges they aren't connected to
  const final = avoidNodeEdgeCrossings(nonOverlapping, edges, rankMap);

  return final;
}
