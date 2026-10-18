import { useEffect, useRef, useState } from 'react';
import type { ActivityHistoryDTO } from '@/api/engine';
import { diffVariables, namedVariables } from '@/lib/run/variableChanges';

export interface VariableChanges {
  /** The paths to flash, and to mark until the next change. */
  changed: ReadonlySet<string>;
  /** Bumped on every new change set. */
  key: number;
  /** Changes read but not shown yet, because the playback is behind. */
  held: boolean;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The variables that changed in the last update (M5 S11). Two reads are
 * compared; while the playback lags behind the real state the difference is
 * held, and it is shown when the playback catches up, so nothing is shown
 * before the step that caused it is on screen. A visible fact that names the
 * variables it wrote (`VARIABLES_UPDATED`, a decision's outputs) shows them as
 * it appears. The first read and a new `resetKey` show nothing.
 */
export function useVariableChanges(
  variables: Record<string, unknown> | null,
  options: { visibleFacts?: ActivityHistoryDTO[]; lag?: number; resetKey?: string } = {},
): VariableChanges {
  const { visibleFacts, lag = 0, resetKey } = options;
  const [state, setState] = useState<VariableChanges>({ changed: NONE, key: 0, held: false });
  const previous = useRef<Record<string, unknown> | null>(null);
  const pending = useRef<Set<string>>(new Set());
  const seenFacts = useRef<Set<string> | null>(null);

  useEffect(() => {
    previous.current = null;
    pending.current = new Set();
    seenFacts.current = null;
    setState({ changed: NONE, key: 0, held: false });
  }, [resetKey]);

  const publish = (paths: Iterable<string>) =>
    setState((current) => ({ changed: new Set(paths), key: current.key + 1, held: pending.current.size > 0 && lag > 0 }));

  // A new read: compare it with the last one.
  useEffect(() => {
    if (!variables) return;
    if (previous.current) diffVariables(previous.current, variables).forEach((path) => pending.current.add(path));
    previous.current = variables;
    if (pending.current.size === 0) return;
    if (lag === 0) {
      const paths = pending.current;
      pending.current = new Set();
      publish(paths);
    } else {
      setState((current) => (current.held ? current : { ...current, held: true }));
    }
    // `lag` is read, not followed: the release below handles it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variables]);

  // The playback caught up: show what was held.
  useEffect(() => {
    if (lag > 0 || pending.current.size === 0) return;
    const paths = pending.current;
    pending.current = new Set();
    publish(paths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lag]);

  // Facts that name the variables they wrote, as they become visible.
  useEffect(() => {
    if (!visibleFacts) return;
    if (!seenFacts.current) {
      seenFacts.current = new Set(visibleFacts.map((fact) => fact.id));
      return;
    }
    const named: string[] = [];
    for (const fact of visibleFacts) {
      if (seenFacts.current.has(fact.id)) continue;
      seenFacts.current.add(fact.id);
      named.push(...namedVariables(fact));
    }
    if (named.length) publish(named);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleFacts]);

  return state;
}
