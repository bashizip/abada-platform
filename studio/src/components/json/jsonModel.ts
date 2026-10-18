/**
 * The JSON viewer's model (M5 S11): a JSON value as a tree of nodes, each with
 * the exact path a user copies (`applicant.address.city`, `items[2].sku`,
 * `meta["x-trace"]`). Pure, so search, rows and the JSON view share it.
 */

/** What the engine writes in place of a masked value (`EvidenceRedactor.MASK`). */
export const REDACTION_MASK = '****';

export type JsonKind =
  | 'string' | 'number' | 'boolean' | 'null'
  | 'object' | 'array'
  /** The engine's mask: rendered as a badge, never as text. */
  | 'redacted'
  /** A file reference (M5 S9 shape): rendered as a chip. */
  | 'file';

export interface FileReference {
  fileId: string;
  name: string;
  contentType: string;
  size: number;
  sha256?: string;
}

export interface JsonNode {
  id: number;
  /** Object key, or array index. */
  key: string | number;
  path: string;
  depth: number;
  kind: JsonKind;
  value: unknown;
  parent: JsonNode | null;
  /** Objects and arrays only. */
  children?: JsonNode[];
}

export interface JsonTreeModel {
  roots: JsonNode[];
  /** Every node, parents before their children. */
  all: JsonNode[];
  byPath: Map<string, JsonNode>;
  /** Deepest node depth (0 = top level). */
  maxDepth: number;
  /** Leaves: primitives, redacted values and file references. */
  values: number;
  /** True when the roots are the entries of an object (a variable map), false for a single value. */
  record: boolean;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The path of `key` under `base`: dots for identifiers, `[n]` for indexes, `["…"]` otherwise. */
export function joinPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  if (IDENTIFIER.test(key)) return base ? `${base}.${key}` : key;
  return `${base}[${JSON.stringify(key)}]`;
}

export function isFileReference(value: unknown): value is FileReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.fileId === 'string' && typeof record.name === 'string'
    && typeof record.contentType === 'string' && typeof record.size === 'number';
}

function kindOf(value: unknown): JsonKind {
  if (value === null || value === undefined) return 'null';
  if (value === REDACTION_MASK) return 'redacted';
  if (Array.isArray(value)) return 'array';
  if (isFileReference(value)) return 'file';
  switch (typeof value) {
    case 'string': return 'string';
    case 'number': case 'bigint': return 'number';
    case 'boolean': return 'boolean';
    case 'object': return 'object';
    default: return 'string';
  }
}

/**
 * Builds the tree of a JSON value. An object's entries are the top-level
 * nodes; any other value becomes a single node keyed `value`.
 */
export function buildJsonTree(data: unknown): JsonTreeModel {
  const all: JsonNode[] = [];
  const byPath = new Map<string, JsonNode>();
  let maxDepth = 0;
  let values = 0;
  const make = (value: unknown, key: string | number, path: string, depth: number, parent: JsonNode | null): JsonNode => {
    const node: JsonNode = { id: all.length, key, path, depth, kind: kindOf(value), value, parent };
    all.push(node);
    byPath.set(path, node);
    if (depth > maxDepth) maxDepth = depth;
    if (node.kind === 'array') {
      node.children = (value as unknown[]).map((item, index) => make(item, index, joinPath(path, index), depth + 1, node));
    } else if (node.kind === 'object') {
      node.children = Object.entries(value as Record<string, unknown>)
        .map(([childKey, child]) => make(child, childKey, joinPath(path, childKey), depth + 1, node));
    } else {
      values += 1;
    }
    return node;
  };
  const isRecord = data !== null && typeof data === 'object' && !Array.isArray(data) && !isFileReference(data);
  const roots = isRecord
    ? Object.entries(data as Record<string, unknown>).map(([key, value]) => make(value, key, joinPath('', key), 0, null))
    : data === undefined ? [] : [make(data, 'value', 'value', 0, null)];
  return { roots, all, byPath, maxDepth, values, record: isRecord };
}

/**
 * Stands for one inline mask in a string (the redactor replaces sensitive
 * substrings), so truncating or wrapping a string never cuts a mask in half
 * and the renderer draws a badge where it stood.
 */
export const MASK_MARK = '\u0000';

export function markMasks(text: string): string {
  return text.includes(REDACTION_MASK) ? text.split(REDACTION_MASK).join(MASK_MARK) : text;
}

/** What *Copy value* puts on the clipboard: a string's text, anything else as JSON; nothing for a mask. */
export function copyableValue(node: JsonNode): string | null {
  if (node.kind === 'redacted') return null;
  if (node.kind === 'string') return node.value as string;
  return JSON.stringify(node.value, null, 2) ?? 'null';
}

/** True when `path` lies strictly inside the node at `ancestor`. */
export function isInside(path: string, ancestor: string): boolean {
  if (path.length <= ancestor.length || !path.startsWith(ancestor)) return false;
  const next = path[ancestor.length];
  return next === '.' || next === '[';
}

/** The paths of every container up to `level` levels deep (level 1 = the top-level containers). */
export function containersToLevel(tree: JsonTreeModel, level: number): Set<string> {
  return new Set(tree.all.filter((node) => node.children && node.depth < level).map((node) => node.path));
}
