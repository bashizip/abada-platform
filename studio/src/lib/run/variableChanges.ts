import type { ActivityHistoryDTO } from '@/api/engine';
import { joinPath } from '@/components/json/jsonModel';

/**
 * Which variables changed (M5 S11), from recorded facts only. The variables
 * endpoint returns the current state, so two reads are compared path by path;
 * the history names variables only for `VARIABLES_UPDATED` (`variableNames`)
 * and `DECISION_TABLE_APPLIED` (`outputNames`).
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const sameValue = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * The paths that differ between two reads: added, removed and changed values.
 * A value added or removed as a whole is reported once, at its own path.
 */
export function diffVariables(previous: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const changed: string[] = [];
  const walk = (before: unknown, after: unknown, path: string) => {
    if (isPlainObject(before) && isPlainObject(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        walk(before[key], after[key], joinPath(path, key));
      }
    } else if (Array.isArray(before) && Array.isArray(after)) {
      for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
        walk(before[index], after[index], joinPath(path, index));
      }
    } else if (!sameValue(before, after)) {
      changed.push(path);
    }
  };
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) walk(previous[key], next[key], joinPath('', key));
  return changed;
}

/** The variables a fact names as written: top-level names, as paths. */
export function namedVariables(fact: ActivityHistoryDTO): string[] {
  const details = (fact.details ?? {}) as Record<string, unknown>;
  const names = fact.eventType === 'VARIABLES_UPDATED' ? details.variableNames
    : fact.eventType === 'DECISION_TABLE_APPLIED' ? details.outputNames : undefined;
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string').map((name) => joinPath('', name)) : [];
}
