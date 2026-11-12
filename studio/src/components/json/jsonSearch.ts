import { markMasks, type JsonNode, type JsonTreeModel } from './jsonModel';

export interface JsonSearch {
  query: string;
  /** Matching nodes, in document order (`all` is built depth first). */
  hits: JsonNode[];
  /** Nodes shown while searching: the hits and their ancestors. */
  shown: Set<number>;
  /** Containers opened by the search: the ancestors of the hits. */
  opened: Set<number>;
}

/** The text a node's value can be found by; a masked value has none. */
function searchableValue(node: JsonNode): string | null {
  switch (node.kind) {
    case 'string': return markMasks(node.value as string);
    case 'number': case 'boolean': return String(node.value);
    case 'null': return 'null';
    case 'file': return (node.value as { name: string }).name;
    default: return null;
  }
}

/** Case-insensitive search across keys and values. Returns null for an empty query. */
export function searchJsonTree(tree: JsonTreeModel, rawQuery: string): JsonSearch | null {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return null;
  const hits: JsonNode[] = [];
  const shown = new Set<number>();
  const opened = new Set<number>();
  for (const node of tree.all) {
    const value = searchableValue(node);
    const matches = String(node.key).toLowerCase().includes(query) || (value !== null && value.toLowerCase().includes(query));
    if (!matches) continue;
    hits.push(node);
    shown.add(node.id);
    for (let parent = node.parent; parent && !opened.has(parent.id); parent = parent.parent) {
      shown.add(parent.id);
      opened.add(parent.id);
    }
  }
  return { query, hits, shown, opened };
}

/** The start offsets of `query` (lower case) in `text`, case-insensitively. */
export function matchRanges(text: string, query: string | undefined): [number, number][] {
  if (!query) return [];
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, at + query.length)) {
    ranges.push([at, at + query.length]);
  }
  return ranges;
}
