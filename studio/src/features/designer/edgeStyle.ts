import { palette } from '@/lib/tokens';
/**
 * Visual variants an edge can take. Each variant has its own arrowhead so the
 * arrow always matches the stroke colour of the line it terminates.
 */
export type EdgeVariant =
  | 'default'
  | 'selected'
  | 'active'
  | 'error'
  | 'warn'
  | 'added'
  | 'modified'
  | 'removed'
  | 'path'
  | 'unreached';

export const EDGE_COLORS: Record<EdgeVariant, string> = {
  // ~3.9:1 against the #1A1614 canvas: readable without competing with nodes.
  default: palette.sandDim,
  selected: palette.linen,
  active: palette.amethyst,
  error: palette.desertRose,
  warn: palette.saffron,
  added: palette.sageGreen,
  modified: palette.saffron,
  removed: palette.desertRose,
  // The path an instance took: the densest accent, ≥ 3:1 against the canvas (see edgeStyle.test.ts).
  path: palette.amethystBright,
  // Never reached: recedes behind the path, still visible as the rest of the design.
  unreached: palette.stone,
};

/** Stroke of each path layer: taken is thick and solid, not reached thin and dashed. */
export const PATH_STROKE = {
  taken: { width: 3, dash: undefined },
  unreached: { width: 1, dash: '4 4' },
} as const;
