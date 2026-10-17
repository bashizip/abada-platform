import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PACE_DWELL_MS, usePlaybackPace, type PlaybackPace } from '@/lib/run/playbackPace';

export interface PacedPlaybackOptions<T> {
  /** Identity of a fact: a fact seen twice (at-least-once delivery, refetch) is shown once. */
  id: (fact: T) => string;
  /** Facts that are a visible step; the others ride along with the next step. Default: every fact. */
  isStep?: (fact: T) => boolean;
  /** Consecutive steps shown together (the branches a parallel split starts). */
  sameStep?: (previous: T, next: T) => boolean;
  /** A fact never held back: when one is pending, playback catches up to now. */
  isUrgent?: (fact: T) => boolean;
  /**
   * The urgent conditions of the real state (terminal status, open incidents…)
   * as a signature. A change to a new non-empty value catches playback up.
   */
  urgentKey?: string;
  /** What is played: a new key (another instance, a new run) starts over at its current state. */
  resetKey?: string;
  /** Overrides the user's pace preference (tests). */
  pace?: PlaybackPace;
}

export interface PacedPlayback<T> {
  /** The facts shown so far: always a prefix of the real, deduplicated facts. */
  visible: T[];
  /** Steps the playback is behind the real state (0 = showing now). */
  lag: number;
  /** Shows the real state at once. */
  jumpToNow: () => void;
  pace: PlaybackPace;
  setPace: (pace: PlaybackPace) => void;
}

interface PlaybackState {
  key: string | undefined;
  /** Facts shown; null until the first facts arrive (they are shown at once, never replayed). */
  shown: number | null;
  urgentKey: string | undefined;
}

/** End (exclusive) of each step: a step fact, plus the facts before it and the steps grouped with it. */
export function stepEnds<T>(facts: T[], isStep: (fact: T) => boolean,
  sameStep?: (previous: T, next: T) => boolean): number[] {
  const ends: number[] = [];
  let index = 0;
  while (index < facts.length) {
    if (!isStep(facts[index])) { index += 1; continue; }
    let end = index + 1;
    while (end < facts.length && isStep(facts[end]) && sameStep?.(facts[end - 1], facts[end])) end += 1;
    ends.push(end);
    index = end;
  }
  return ends;
}

/** Where the next step leaves the playback; the last step also reveals the facts after it. */
function nextCut(ends: number[], shown: number, length: number): number {
  const next = ends.find((end) => end > shown);
  if (next === undefined || !ends.some((end) => end > next)) return length;
  return next;
}

/**
 * Plays an ordered, cumulative list of facts back at a human pace (M5 S3):
 * one visible step per dwell, while the engine keeps running at full speed.
 * The visible facts are always a prefix of the real ones, and the playback
 * says how far behind it is. The state at opening is shown at once; only
 * facts arriving afterwards are paced. Urgent facts (incidents, terminal
 * states, a task waiting on the viewer) are never queued: the playback
 * catches up to them. `instant` shows every fact as it arrives.
 */
export function usePacedPlayback<T>(facts: T[], options: PacedPlaybackOptions<T>): PacedPlayback<T> {
  const { id, isStep, sameStep, isUrgent, urgentKey, resetKey } = options;
  const [preferredPace, setPace] = usePlaybackPace();
  const pace = options.pace ?? preferredPace;
  const dwell = PACE_DWELL_MS[pace];

  const unique = useMemo(() => {
    const seen = new Set<string>();
    return facts.filter((fact) => {
      const key = id(fact);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [facts, id]);
  const length = unique.length;
  const ends = useMemo(() => stepEnds(unique, isStep ?? (() => true), sameStep), [unique, isStep, sameStep]);
  const endsSignature = ends.join(',');

  const [state, setState] = useState<PlaybackState>({ key: resetKey, shown: null, urgentKey: undefined });

  // Adjust during render (not in an effect) so a reset or catch-up never paints a stale frame.
  let next = state;
  if (next.key !== resetKey) next = { key: resetKey, shown: null, urgentKey: undefined };
  if (next.shown === null) {
    if (length > 0) next = { ...next, shown: length, urgentKey };
  } else {
    if (urgentKey !== next.urgentKey) {
      next = { ...next, urgentKey, shown: urgentKey ? length : next.shown };
    }
    const shown = next.shown ?? 0;
    const urgentPending = !!isUrgent && unique.slice(shown).some(isUrgent);
    if (shown < length && (pace === 'instant' || urgentPending)) next = { ...next, shown: length };
  }
  if (next !== state) setState(next);

  const shown = Math.min(next.shown ?? length, length);
  const lastRevealAt = useRef(Number.NEGATIVE_INFINITY);
  const lengthRef = useRef(length);
  useEffect(() => { lengthRef.current = length; }, [length]);

  useEffect(() => {
    if (next.shown === null || shown >= length || pace === 'instant') return undefined;
    const target = nextCut(ends, shown, length);
    const wait = Math.max(0, lastRevealAt.current + dwell - Date.now());
    const timer = setTimeout(() => {
      lastRevealAt.current = Date.now();
      setState((previous) => (previous.key === resetKey && previous.shown === shown
        ? { ...previous, shown: target } : previous));
    }, wait);
    return () => clearTimeout(timer);
    // `ends` is represented by its signature: a refetch of the same facts keeps the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next.shown === null, shown, length, endsSignature, dwell, pace, resetKey]);

  const jumpToNow = useCallback(() => {
    setState((previous) => ({ ...previous, shown: lengthRef.current }));
  }, []);

  const visible = useMemo(() => (shown >= length ? unique : unique.slice(0, shown)), [unique, shown, length]);
  const lag = ends.filter((end) => end > shown).length;

  return { visible, lag, jumpToNow, pace, setPace };
}
