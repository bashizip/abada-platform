/**
 * A line tokenizer for highlighting APL YAML (M5 S12), dependency free like the JSON viewer's.
 * It colours what a reader scans for (keys, list dashes, scalars, `${…}` expressions,
 * comments) and never changes the text: joining a line's tokens gives the line back.
 */

export type YamlTokenKind =
  | 'key' | 'punct' | 'string' | 'number' | 'boolean' | 'null' | 'expression' | 'comment' | 'text';

export interface YamlToken {
  kind: YamlTokenKind;
  text: string;
}

const SCALAR_NUMBER = /^[-+]?(\d[\d_]*(\.\d+)?([eE][-+]?\d+)?|\.\d+)$/;
const SCALAR_BOOLEAN = /^(true|false|yes|no|on|off)$/i;
const SCALAR_NULL = /^(null|~)$/i;

/** Where a `#` comment starts, outside quotes and `${…}` (a `#` must follow a space or start the line). */
function commentStart(line: string): number {
  let quote: string | null = null;
  let braces = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === quote && line[i - 1] !== '\\') quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '$' && line[i + 1] === '{') {
      braces++;
    } else if (char === '}' && braces > 0) {
      braces--;
    } else if (char === '#' && braces === 0 && (i === 0 || /\s/.test(line[i - 1]))) {
      return i;
    }
  }
  return -1;
}

/** A value: a whole scalar is typed; inside anything else, `${…}` expressions stand out. */
function valueTokens(value: string): YamlToken[] {
  if (!value) return [];
  const trimmed = value.trim();
  const lead = value.slice(0, value.indexOf(trimmed));
  const trail = value.slice(lead.length + trimmed.length);
  const typed = (kind: YamlTokenKind): YamlToken[] =>
    [...(lead ? [{ kind: 'text' as const, text: lead }] : []), { kind, text: trimmed },
      ...(trail ? [{ kind: 'text' as const, text: trail }] : [])];
  if (!trimmed.includes('${')) {
    if (/^(["']).*\1$/.test(trimmed)) return typed('string');
    if (SCALAR_NUMBER.test(trimmed)) return typed('number');
    if (SCALAR_BOOLEAN.test(trimmed)) return typed('boolean');
    if (SCALAR_NULL.test(trimmed)) return typed('null');
    if (/^[|>][-+]?$/.test(trimmed)) return typed('punct');
  }
  const tokens: YamlToken[] = [];
  const pattern = /\$\{[^}]*\}|[[\]{},]/g;
  let last = 0;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    if (match.index > last) tokens.push({ kind: 'string', text: value.slice(last, match.index) });
    tokens.push({ kind: match[0].startsWith('${') ? 'expression' : 'punct', text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < value.length) tokens.push({ kind: 'string', text: value.slice(last) });
  // Leading spaces are layout, not part of the string.
  if (tokens[0]?.kind === 'string' && /^\s+/.test(tokens[0].text)) {
    const space = /^\s+/.exec(tokens[0].text)![0];
    tokens.splice(0, 1, { kind: 'text', text: space }, { kind: 'string', text: tokens[0].text.slice(space.length) });
    if (!tokens[1].text) tokens.splice(1, 1);
  }
  return tokens;
}

export function tokenizeYamlLine(line: string): YamlToken[] {
  const tokens: YamlToken[] = [];
  const hash = commentStart(line);
  const body = hash >= 0 ? line.slice(0, hash) : line;
  const comment = hash >= 0 ? line.slice(hash) : '';

  const indent = /^\s*/.exec(body)![0];
  let rest = body.slice(indent.length);
  if (indent) tokens.push({ kind: 'text', text: indent });
  // List items: "- " (possibly several, as in "- - a").
  for (let dash = /^-(\s+|$)/.exec(rest); dash; dash = /^-(\s+|$)/.exec(rest)) {
    tokens.push({ kind: 'punct', text: dash[0] });
    rest = rest.slice(dash[0].length);
  }
  const key = /^([^\s"'{[#][^:#]*?|"[^"]*"|'[^']*'):(\s|$)/.exec(rest);
  if (key) {
    tokens.push({ kind: 'key', text: key[1] }, { kind: 'punct', text: ':' });
    rest = rest.slice(key[1].length + 1);
  }
  tokens.push(...valueTokens(rest));
  if (comment) tokens.push({ kind: 'comment', text: comment });
  return tokens;
}

/** Lines of a document; the lines of a block scalar (`prompt: |`) are text, not keys. */
export function tokenizeYaml(source: string): YamlToken[][] {
  let blockIndent: number | null = null;
  let opener = -1;
  return source.replace(/\n$/, '').split('\n').map((line) => {
    const indent = /^\s*/.exec(line)![0].length;
    if (blockIndent !== null) {
      if (!line.trim() || indent > opener) {
        blockIndent = blockIndent || indent;
        const lead = line.slice(0, Math.min(indent, blockIndent));
        return [...(lead ? [{ kind: 'text' as const, text: lead }] : []),
          ...(line.length > lead.length ? [{ kind: 'string' as const, text: line.slice(lead.length) }] : [])];
      }
      blockIndent = null;
    }
    const tokens = tokenizeYamlLine(line);
    const last = [...tokens].reverse().find((token) => token.kind !== 'text' && token.kind !== 'comment');
    if (last?.kind === 'punct' && /^[|>][-+]?$/.test(last.text)) {
      blockIndent = 0;
      opener = indent;
    }
    return tokens;
  });
}
