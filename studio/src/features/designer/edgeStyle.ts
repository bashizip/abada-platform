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
  | 'removed';

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
};
