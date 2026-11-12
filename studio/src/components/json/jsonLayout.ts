import { buildJsonTree } from './jsonModel';

/** Height of one tree row or JSON line, in px (the rows are windowed). */
export const ROW_HEIGHT = 22;

/** Text colour per value type: one scale for the tree and the JSON view. */
export const VALUE_TONE = {
  string: 'text-sage-green',
  number: 'text-saffron',
  boolean: 'text-amethyst-light',
  null: 'italic text-sand',
} as const;

/**
 * A height for a compact viewer that fits what opens at `depth` levels, up
 * to `maxRows` (then the viewer scrolls).
 */
export function jsonHeight(value: unknown, depth = 2, maxRows = 10): number {
  const rows = buildJsonTree(value).all.filter((node) => node.depth <= depth).length;
  return Math.min(maxRows, Math.max(1, rows)) * ROW_HEIGHT + 2;
}
