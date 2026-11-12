import { markMasks, type JsonNode, type JsonTreeModel } from './jsonModel';
import type { JsonSearch } from './jsonSearch';

/** Strings longer than this are cut, with *show more*. */
export const LONG_STRING = 120;

/** One fixed-height row of the tree: a node, or one wrapped line of an opened long string. */
export interface TreeRow {
  node: JsonNode;
  /** Set on the wrapped lines of an opened long string (masks as `MASK_MARK`). */
  continuation?: string;
}

export interface TreeRowState {
  expanded: ReadonlySet<string>;
  /** Long strings opened with *show more*, by path. */
  openStrings: ReadonlySet<string>;
  search: JsonSearch | null;
  /** How many monospace characters fit on a wrapped line at `depth`. */
  charsPerLine: (depth: number) => number;
}

export const isLongString = (node: JsonNode): boolean =>
  node.kind === 'string' && (node.value as string).length > LONG_STRING;

/** A container is open when the user expanded it or a search match lies inside it. */
export function isOpen(node: JsonNode, expanded: ReadonlySet<string>, search: JsonSearch | null): boolean {
  if (!node.children) return false;
  return expanded.has(node.path) || (search?.opened.has(node.id) ?? false);
}

/** Flattens the visible part of the tree into rows, in document order. */
export function treeRows(tree: JsonTreeModel, state: TreeRowState): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (nodes: JsonNode[]) => {
    for (const node of nodes) {
      if (state.search && !state.search.shown.has(node.id)) continue;
      rows.push({ node });
      if (isLongString(node) && state.openStrings.has(node.path)) {
        const text = markMasks(node.value as string);
        const width = Math.max(16, state.charsPerLine(node.depth + 1));
        for (let at = 0; at < text.length; at += width) rows.push({ node, continuation: text.slice(at, at + width) });
      }
      if (node.children && isOpen(node, state.expanded, state.search)) walk(node.children);
    }
  };
  walk(tree.roots);
  return rows;
}

/** The index of the row that shows `node` itself (not a wrapped line), or -1. */
export const rowIndexOf = (rows: TreeRow[], node: JsonNode): number =>
  rows.findIndex((row) => row.node === node && row.continuation === undefined);
