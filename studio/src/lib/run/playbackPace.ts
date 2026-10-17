import { useSyncExternalStore } from 'react';
import { duration } from '@/lib/motion';

/**
 * How fast the Studio replays what an instance did (M5 S3). A presentation
 * preference only: the engine always runs at full speed.
 */
export type PlaybackPace = 'calm' | 'brisk' | 'instant';

export const PLAYBACK_PACES: readonly PlaybackPace[] = ['calm', 'brisk', 'instant'];

/** Minimum time each visible step holds before the next one appears. */
export const PACE_DWELL_MS: Record<PlaybackPace, number> = {
  calm: duration.calm,
  brisk: 250,
  instant: 0,
};

export const PACE_LABELS: Record<PlaybackPace, string> = {
  calm: 'Calm',
  brisk: 'Brisk',
  instant: 'Instant',
};

const STORAGE_KEY = 'abada.playbackPace';
const DEFAULT_PACE: PlaybackPace = 'calm';

const isPace = (value: unknown): value is PlaybackPace =>
  typeof value === 'string' && (PLAYBACK_PACES as readonly string[]).includes(value);

function readStored(): PlaybackPace {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isPace(stored) ? stored : DEFAULT_PACE;
  } catch {
    return DEFAULT_PACE;
  }
}

let current: PlaybackPace | null = null;
const listeners = new Set<() => void>();

/** The user's pace (per browser, default calm). */
export function readPlaybackPace(): PlaybackPace {
  current ??= readStored();
  return current;
}

export function writePlaybackPace(pace: PlaybackPace): void {
  current = pace;
  try {
    window.localStorage.setItem(STORAGE_KEY, pace);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** The pace preference, shared by every view that plays a run back (instance views, Dry Run). */
export function usePlaybackPace(): [PlaybackPace, (pace: PlaybackPace) => void] {
  const pace = useSyncExternalStore(subscribe, readPlaybackPace, () => DEFAULT_PACE);
  return [pace, writePlaybackPace];
}

/** Tests only: forget the cached preference so the next read goes back to storage. */
export function resetPlaybackPaceForTests(): void {
  current = null;
}
