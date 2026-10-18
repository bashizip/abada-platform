import type { JsonNode, JsonTreeModel } from './jsonModel';
import { REDACTION_MASK } from './jsonModel';

/**
 * The JSON view's tokenizer (M5 S11): the tree as formatted JSON lines, with
 * token kinds for highlighting, real line numbers and fold ranges. Dependency
 * free, so no highlighter is added to the bundle. Joining the lines gives
 * exactly `JSON.stringify(data, null, 2)`.
 */

export type JsonTokenKind = 'key' | 'punct' | 'string' | 'number' | 'boolean' | 'null' | 'redacted';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

export interface JsonLine {
  /** 1-based line number in the whole document. */
  number: number;
  depth: number;
  tokens: JsonToken[];
  /** The node this line shows (its value, or the opening of its container). */
  node?: JsonNode;
  /** On an opening line: the index of its closing line. */
  foldEnd?: number;
}

export interface VisibleJsonLine extends JsonLine {
  /** Set when the container opened here is folded. */
  folded?: { count: number; kind: 'object' | 'array'; comma: boolean };
}

const punct = (text: string): JsonToken => ({ kind: 'punct', text });

function primitiveToken(value: unknown): JsonToken {
  if (value === REDACTION_MASK) return { kind: 'redacted', text: JSON.stringify(value) };
  if (value === null || value === undefined) return { kind: 'null', text: 'null' };
  if (typeof value === 'string') return { kind: 'string', text: JSON.stringify(value) };
  if (typeof value === 'number') return { kind: 'number', text: JSON.stringify(value) };
  if (typeof value === 'boolean') return { kind: 'boolean', text: String(value) };
  return { kind: 'string', text: JSON.stringify(value) ?? 'null' };
}

export function jsonLines(tree: JsonTreeModel): JsonLine[] {
  const lines: Omit<JsonLine, 'number'>[] = [];

  /** Emits `value` (with its node when the tree has one; a file reference's fields have none). */
  const emit = (value: unknown, node: JsonNode | undefined, key: string | number | null, depth: number, last: boolean) => {
    const lead: JsonToken[] = key === null || typeof key === 'number' ? [] : [{ kind: 'key', text: JSON.stringify(key) }, punct(': ')];
    const comma = last ? [] : [punct(',')];
    const isArray = Array.isArray(value);
    const isContainer = value !== null && typeof value === 'object';
    if (!isContainer) {
      lines.push({ depth, tokens: [...lead, primitiveToken(value), ...comma], node });
      return;
    }
    const entries: [string | number, unknown, JsonNode | undefined][] = node?.children
      ? node.children.map((child) => [child.key, child.value, child])
      : isArray
        ? (value as unknown[]).map((item, index) => [index, item, undefined])
        : Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, child, undefined]);
    const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
    if (entries.length === 0) {
      lines.push({ depth, tokens: [...lead, punct(open + close), ...comma], node });
      return;
    }
    const start = lines.length;
    lines.push({ depth, tokens: [...lead, punct(open)], node });
    entries.forEach(([childKey, child, childNode], index) =>
      emit(child, childNode, isArray ? index : childKey, depth + 1, index === entries.length - 1));
    lines.push({ depth, tokens: [punct(close), ...comma] });
    lines[start].foldEnd = lines.length - 1;
  };

  if (tree.record) {
    if (tree.roots.length === 0) lines.push({ depth: 0, tokens: [punct('{}')] });
    else {
      lines.push({ depth: 0, tokens: [punct('{')] });
      tree.roots.forEach((root, index) => emit(root.value, root, root.key, 1, index === tree.roots.length - 1));
      lines.push({ depth: 0, tokens: [punct('}')] });
      lines[0].foldEnd = lines.length - 1;
    }
  } else if (tree.roots[0]) {
    emit(tree.roots[0].value, tree.roots[0], null, 0, true);
  }
  return lines.map((line, index) => ({ ...line, number: index + 1 }));
}

/** The text of one line, indented as `JSON.stringify(…, null, 2)` does. */
export const lineText = (line: JsonLine): string => '  '.repeat(line.depth) + line.tokens.map((token) => token.text).join('');

/**
 * The lines left once folded containers are collapsed to one line each.
 * `forcedOpen` holds node ids a search keeps open.
 */
export function visibleJsonLines(lines: JsonLine[], folded: ReadonlySet<string>, forcedOpen?: ReadonlySet<number>): VisibleJsonLine[] {
  const out: VisibleJsonLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const node = line.node;
    if (line.foldEnd !== undefined && node && folded.has(node.path) && !forcedOpen?.has(node.id)) {
      const closing = lines[line.foldEnd];
      out.push({
        ...line,
        folded: {
          count: node.children?.length ?? Object.keys(node.value as object).length,
          kind: Array.isArray(node.value) ? 'array' : 'object',
          comma: closing.tokens.some((token) => token.text === ','),
        },
      });
      index = line.foldEnd;
    } else {
      out.push(line);
    }
  }
  return out;
}
