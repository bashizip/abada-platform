import type { DMNRule, DMNValue } from '@/types';

/**
 * Pure helpers behind the decision-table editor. APL has no output
 * declarations: the outputs are the keys the rules' `then` maps set.
 */

/** Rules in the order the panel shows them: conditional rules as authored, then the fallback(s). */
export const displayOrder = (rules: DMNRule[]): DMNRule[] =>
  [...rules.filter((rule) => !rule.otherwise), ...rules.filter((rule) => rule.otherwise)];

/**
 * Moves the conditional rule at display position `from` to `to`. The fallback
 * applies only when nothing matched, wherever it is written, so it is kept
 * last; the result is in display order.
 */
export function moveRule(rules: DMNRule[], from: number, to: number): DMNRule[] {
  const conditional = rules.filter((rule) => !rule.otherwise);
  if (from < 0 || from >= conditional.length || to < 0 || to >= conditional.length || from === to) return rules;
  const next = [...conditional];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return [...next, ...rules.filter((rule) => rule.otherwise)];
}

/** Output names, in first-seen order across the rules, then `extra` columns not set by any rule yet. */
export function outputColumns(rules: DMNRule[], extra: string[] = []): string[] {
  const names: string[] = [];
  for (const rule of rules) for (const name of Object.keys(rule.then ?? {})) if (!names.includes(name)) names.push(name);
  for (const name of extra) if (name && !names.includes(name)) names.push(name);
  return names;
}

/** A fresh output name not among `columns`. */
export function addOutputColumn(columns: string[]): string {
  let name = 'output';
  for (let n = 2; columns.includes(name); n++) name = `output_${n}`;
  return name;
}

/** Renames an output in every rule, keeping each rule's key order. */
export const renameOutputColumn = (rules: DMNRule[], from: string, to: string): DMNRule[] =>
  rules.map((rule) => (from in rule.then
    ? { ...rule, then: Object.fromEntries(Object.entries(rule.then).map(([key, value]) => [key === from ? to : key, value])) }
    : rule));

export const removeOutputColumn = (rules: DMNRule[], name: string): DMNRule[] =>
  rules.map((rule) => (name in rule.then ? { ...rule, then: setRuleOutput(rule.then, name, undefined) } : rule));

/** Sets one output of a rule; `undefined` removes it (the rule then does not write that variable). */
export function setRuleOutput(then: Record<string, DMNValue>, name: string, value: DMNValue | undefined): Record<string, DMNValue> {
  const next = { ...then };
  if (value === undefined) delete next[name];
  else next[name] = value;
  return next;
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * Reads a typed value: `true`/`false` are booleans, numerals are numbers,
 * `"…"` is text kept as written (so `"42"` stays text), anything else is
 * text; empty is no value.
 */
export function parseValue(text: string): DMNValue | undefined {
  const value = text.trim();
  if (value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (NUMBER.test(value)) return Number(value);
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Not valid JSON text: keep it as written.
    }
  }
  return value;
}

/** The text `parseValue` reads back as the same value. */
export function formatValue(value: DMNValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') return String(value);
  return parseValue(value) === value ? value : JSON.stringify(value);
}

export const valueKind = (value: DMNValue | undefined): 'text' | 'number' | 'boolean' =>
  typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text';
