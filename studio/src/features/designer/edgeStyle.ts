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
  default: '#8A7F74',
  selected: '#EAE3D9',
  active: '#9D4EDD',
  error: '#E76F51',
  warn: '#F4A261',
  added: '#90A955',
  modified: '#F4A261',
  removed: '#E76F51',
};
