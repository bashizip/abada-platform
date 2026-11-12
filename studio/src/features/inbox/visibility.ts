/**
 * `visible_when` for task-form fields: the portable CEL subset the engine
 * re-checks on completion (`engine/.../forms/VisibilityExpression.java`).
 * Both sides run the cases in
 * `engine/src/test/resources/forms/visibility-conformance.json`.
 *
 * Grammar: identifiers, `true false null`, numbers, quoted strings, lists,
 * `== != < <= > >=`, `in`, `&& || !`, unary `-`, parentheses and `size(x)`.
 * A missing variable is null; ordering anything but two numbers or two
 * strings is false; `size(null)` is 0; a field shows only when the result is
 * `true`. Evaluation never throws.
 */
export const MAX_VISIBILITY_LENGTH = 1024;
const MAX_DEPTH = 32;

type Value = unknown;
type Node =
  | { k: 'lit'; v: Value }
  | { k: 'id'; name: string }
  | { k: 'list'; items: Node[] }
  | { k: 'not'; e: Node }
  | { k: 'neg'; e: Node }
  | { k: 'size'; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node };

interface Token { kind: 'num' | 'str' | 'id' | 'op'; text: string }

export interface VisibilityExpression {
  source: string;
  identifiers: string[];
  test: (values: Record<string, unknown>) => boolean;
}

export class VisibilitySyntaxError extends Error {}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      let end = i + 1;
      let text = '';
      while (end < source.length && source[end] !== c) {
        if (source[end] === '\\') throw new VisibilitySyntaxError('escape sequences are not supported in strings');
        text += source[end++];
      }
      if (end >= source.length) throw new VisibilitySyntaxError('unterminated string');
      tokens.push({ kind: 'str', text });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let end = i;
      while (end < source.length && /[0-9.]/.test(source[end])) end++;
      const number = source.slice(i, end);
      if (!/^\d+(\.\d+)?$/.test(number)) throw new VisibilitySyntaxError(`invalid number '${number}'`);
      tokens.push({ kind: 'num', text: number });
      i = end;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let end = i;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end++;
      tokens.push({ kind: 'id', text: source.slice(i, end) });
      i = end;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { tokens.push({ kind: 'op', text: two }); i += 2; continue; }
    if ('<>!-()[],'.includes(c)) { tokens.push({ kind: 'op', text: c }); i++; continue; }
    throw new VisibilitySyntaxError(`'${c}' is not allowed in a visibility expression${
      c === '.' ? ' (member access and method calls are outside the portable subset)' : ''}`);
  }
  return tokens;
}

const PRECEDENCE: Record<string, number> = {
  '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, in: 3,
};

function parseTokens(tokens: Token[]): Node {
  let at = 0;
  let depth = 0;
  const peek = (): Token | undefined => tokens[at];
  const isOp = (text: string) => {
    const t = peek();
    return !!t && (t.kind === 'op' || t.kind === 'id') && t.text === text;
  };
  const expect = (text: string) => {
    if (!isOp(text)) throw new VisibilitySyntaxError(`expected '${text}' but found '${peek()?.text ?? 'end of expression'}'`);
    at++;
  };

  const expression = (min: number): Node => {
    if (++depth > MAX_DEPTH) throw new VisibilitySyntaxError('expression is nested too deeply');
    let left = unary();
    while (at < tokens.length) {
      const t = tokens[at];
      const binary = t.kind === 'op' || (t.kind === 'id' && t.text === 'in');
      const p = binary ? PRECEDENCE[t.text] ?? -1 : -1;
      if (p < 0 || p < min) break;
      if (p === 3 && left.k === 'bin' && PRECEDENCE[left.op] === 3) {
        throw new VisibilitySyntaxError('comparisons do not chain; combine them with && or ||');
      }
      at++;
      const right = expression(p + 1);
      left = { k: 'bin', op: t.text, l: left, r: right };
    }
    depth--;
    return left;
  };

  const unary = (): Node => {
    if (isOp('!')) { at++; return { k: 'not', e: unary() }; }
    if (isOp('-')) { at++; return { k: 'neg', e: unary() }; }
    return primary();
  };

  const primary = (): Node => {
    const t = peek();
    if (!t) throw new VisibilitySyntaxError('expression ends too early');
    at++;
    if (t.kind === 'num') return { k: 'lit', v: Number(t.text) };
    if (t.kind === 'str') return { k: 'lit', v: t.text };
    if (t.kind === 'id') {
      if (t.text === 'true') return { k: 'lit', v: true };
      if (t.text === 'false') return { k: 'lit', v: false };
      if (t.text === 'null') return { k: 'lit', v: null };
      if (t.text === 'in') throw new VisibilitySyntaxError("'in' needs a value on its left");
      if (t.text === 'size') {
        if (!isOp('(')) throw new VisibilitySyntaxError('size needs parentheses: size(x)');
        at++;
        const e = expression(0);
        expect(')');
        return { k: 'size', e };
      }
      if (isOp('(')) throw new VisibilitySyntaxError(`function '${t.text}' is outside the portable subset (only size() is allowed)`);
      return { k: 'id', name: t.text };
    }
    if (t.text === '(') { const inner = expression(0); expect(')'); return inner; }
    if (t.text === '[') {
      const items: Node[] = [];
      if (!isOp(']')) {
        for (;;) {
          items.push(expression(0));
          if (!isOp(',')) break;
          at++;
        }
      }
      expect(']');
      return { k: 'list', items };
    }
    throw new VisibilitySyntaxError(`unexpected '${t.text}'`);
  };

  const root = expression(0);
  if (at < tokens.length) throw new VisibilitySyntaxError(`unexpected '${tokens[at].text}'`);
  return root;
}

function equal(a: Value, b: Value): boolean {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (typeof x === 'number' && typeof y === 'number') return x === y;
  if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((item, i) => equal(item, y[i]));
  return x === y;
}

function evaluate(node: Node, values: Record<string, unknown>): Value {
  switch (node.k) {
    case 'lit': return node.v;
    case 'id': return Object.prototype.hasOwnProperty.call(values, node.name) ? values[node.name] ?? null : null;
    case 'list': return node.items.map((item) => evaluate(item, values));
    case 'not': return evaluate(node.e, values) !== true;
    case 'neg': { const v = evaluate(node.e, values); return typeof v === 'number' ? -v : null; }
    case 'size': {
      const v = evaluate(node.e, values);
      if (typeof v === 'string') return Array.from(v).length;
      if (Array.isArray(v)) return v.length;
      if (v && typeof v === 'object') return Object.keys(v).length;
      return 0;
    }
    case 'bin': {
      if (node.op === '&&') return evaluate(node.l, values) === true && evaluate(node.r, values) === true;
      if (node.op === '||') return evaluate(node.l, values) === true || evaluate(node.r, values) === true;
      const a = evaluate(node.l, values);
      const b = evaluate(node.r, values);
      switch (node.op) {
        case '==': return equal(a, b);
        case '!=': return !equal(a, b);
        case 'in':
          if (Array.isArray(b)) return b.some((item) => equal(a, item));
          if (b && typeof b === 'object') return typeof a === 'string' && Object.prototype.hasOwnProperty.call(b, a);
          return false;
        default: {
          let cmp: number;
          if (typeof a === 'number' && typeof b === 'number') cmp = Math.sign(a - b);
          else if (typeof a === 'string' && typeof b === 'string') cmp = a < b ? -1 : a > b ? 1 : 0;
          else return false;
          return node.op === '<' ? cmp < 0 : node.op === '<=' ? cmp <= 0 : node.op === '>' ? cmp > 0 : cmp >= 0;
        }
      }
    }
  }
}

function collect(node: Node, names: string[]): void {
  switch (node.k) {
    case 'id': names.push(node.name); break;
    case 'list': node.items.forEach((item) => collect(item, names)); break;
    case 'not': case 'neg': case 'size': collect(node.e, names); break;
    case 'bin': collect(node.l, names); collect(node.r, names); break;
    default: break;
  }
}

const CACHE = new Map<string, VisibilityExpression>();

/** Parses an expression, or throws {@link VisibilitySyntaxError} with a reason. */
export function parseVisibility(source: string): VisibilityExpression {
  const cached = CACHE.get(source);
  if (cached) return cached;
  if (!source || !source.trim()) throw new VisibilitySyntaxError('expression is empty');
  if (source.length > MAX_VISIBILITY_LENGTH) {
    throw new VisibilitySyntaxError(`expression exceeds ${MAX_VISIBILITY_LENGTH} characters`);
  }
  const root = parseTokens(tokenize(source));
  const names: string[] = [];
  collect(root, names);
  const parsed: VisibilityExpression = {
    source,
    identifiers: Array.from(new Set(names)),
    test: (values) => evaluate(root, values ?? {}) === true,
  };
  if (CACHE.size > 500) CACHE.clear();
  CACHE.set(source, parsed);
  return parsed;
}

/** The reason an expression is refused, or null when the engine will accept it. */
export function visibilityProblem(source: string): string | null {
  try {
    parseVisibility(source);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'invalid expression';
  }
}

/** Visible when there is no expression, or it evaluates to true. A broken expression hides nothing. */
export function isVisible(expression: string | undefined, values: Record<string, unknown>): boolean {
  if (!expression) return true;
  try {
    return parseVisibility(expression).test(values);
  } catch {
    return true;
  }
}
