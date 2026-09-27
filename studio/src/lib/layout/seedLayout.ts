import type { WorkflowEdge, WorkflowNode } from '@/types';
import { layerIndex, modelOrder } from './graphOrder';
import { TASK_HEIGHT, TASK_WIDTH, type Rect, sizeOf } from './nodeGeometry';

/** Parser convention: a node without a `ui` position sits at (0, 0). */
export const hasPosition = (node: Pick<WorkflowNode, 'x' | 'y'>): boolean => node.x !== 0 || node.y !== 0;

const LAYER_GAP = 72;
const ROW_GAP = 40;
const ORIGIN = 40;

/**
 * Synchronous placement for nodes without a saved position. It never moves a
 * positioned node.
 *
 * - No node positioned (a fresh APL document): a simple layered grid so the
 *   diagram is legible even before, or without, the ELK auto-layout, and
 *   `layoutPending` asks the canvas to run the real layout.
 * - Some nodes positioned (e.g. event-gateway catch children, which APL never
 *   persists): each missing node goes between its placed neighbours and is
 *   nudged down until it overlaps nothing.
 */
export function seedMissingPositions(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): { nodes: WorkflowNode[]; layoutPending: boolean } {
  if (nodes.length === 0) return { nodes, layoutPending: false };
  const order = modelOrder(nodes, edges);

  if (!nodes.some(hasPosition)) {
    const layers = layerIndex(order, edges);
    const rows = new Map<number, number>();
    const placed = new Map<string, { x: number; y: number }>();
    for (const node of order) {
      const layer = layers.get(node.id) ?? 0;
      const row = rows.get(layer) ?? 0;
      rows.set(layer, row + 1);
      const size = sizeOf(node);
      placed.set(node.id, {
        // Cells are task-sized; smaller shapes are centred in theirs.
        x: ORIGIN + layer * (TASK_WIDTH + LAYER_GAP) + (TASK_WIDTH - size.width) / 2,
        y: ORIGIN + row * (TASK_HEIGHT + ROW_GAP) + (TASK_HEIGHT - size.height) / 2,
      });
    }
    return {
      nodes: nodes.map((node) => ({ ...node, ...placed.get(node.id)! })),
      layoutPending: true,
    };
  }

  const rects = new Map<string, Rect>();
  for (const node of nodes) {
    if (hasPosition(node)) rects.set(node.id, { x: node.x, y: node.y, ...sizeOf(node) });
  }
  const result = new Map(nodes.map((node) => [node.id, node]));
  for (const node of order) {
    if (rects.has(node.id)) continue;
    const size = sizeOf(node);
    const preds = edges.filter((e) => e.target === node.id).map((e) => rects.get(e.source)).filter(Boolean) as Rect[];
    const succs = edges.filter((e) => e.source === node.id).map((e) => rects.get(e.target)).filter(Boolean) as Rect[];
    const pred = preds[0];
    const succ = succs[0];
    let x: number;
    let y: number;
    if (pred && succ) {
      x = (pred.x + pred.width + succ.x) / 2 - size.width / 2;
      y = (pred.y + pred.height / 2 + succ.y + succ.height / 2) / 2 - size.height / 2;
    } else if (pred) {
      x = pred.x + pred.width + LAYER_GAP;
      y = pred.y + pred.height / 2 - size.height / 2;
    } else if (succ) {
      x = succ.x - LAYER_GAP - size.width;
      y = succ.y + succ.height / 2 - size.height / 2;
    } else {
      x = ORIGIN;
      y = Math.max(0, ...[...rects.values()].map((r) => r.y + r.height)) + ROW_GAP;
    }
    const rect: Rect = { x: Math.round(x), y: Math.round(y), ...size };
    while ([...rects.values()].some((r) => overlaps(r, rect, 16))) rect.y += 24;
    rects.set(node.id, rect);
    result.set(node.id, { ...node, x: rect.x, y: rect.y });
  }
  return { nodes: nodes.map((node) => result.get(node.id)!), layoutPending: false };
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap
    && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}
