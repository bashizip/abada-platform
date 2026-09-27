import type { WorkflowNode } from '@/types';
import { type Point, sizeOf } from './nodeGeometry';

/** Centre lines within this distance (flow px) of another node's snap together on drop. */
export const ALIGN_TOLERANCE = 6;

export interface Alignment {
  /** Flow-space x of a vertical guide / y of a horizontal guide. */
  guideX?: number;
  guideY?: number;
  snapped: Point;
}

/**
 * Aligns a dragged node's centre with the nearest other node centre on each
 * axis, within ALIGN_TOLERANCE — the guide lines shown while dragging and the
 * position the node snaps to on drop.
 */
export function alignTo(nodes: WorkflowNode[], id: string, at: Point): Alignment {
  const node = nodes.find((n) => n.id === id);
  if (!node) return { snapped: at };
  const size = sizeOf(node);
  const cx = at.x + size.width / 2;
  const cy = at.y + size.height / 2;
  let guideX: number | undefined;
  let guideY: number | undefined;
  let bestX = ALIGN_TOLERANCE;
  let bestY = ALIGN_TOLERANCE;
  for (const other of nodes) {
    if (other.id === id) continue;
    const o = sizeOf(other);
    const ox = other.x + o.width / 2;
    const oy = other.y + o.height / 2;
    if (Math.abs(ox - cx) < bestX) { bestX = Math.abs(ox - cx); guideX = ox; }
    if (Math.abs(oy - cy) < bestY) { bestY = Math.abs(oy - cy); guideY = oy; }
  }
  return {
    guideX,
    guideY,
    snapped: {
      x: guideX !== undefined ? guideX - size.width / 2 : at.x,
      y: guideY !== undefined ? guideY - size.height / 2 : at.y,
    },
  };
}
