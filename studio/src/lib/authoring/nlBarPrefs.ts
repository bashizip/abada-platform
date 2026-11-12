import { useSyncExternalStore } from 'react';
import { getUserFromToken, keycloak } from '@/auth/keycloakClient';

/**
 * How the natural-language bar sits on the canvas (M5 S12): pinned open, collapsed to a small
 * button, or hidden (⌘K / Ctrl+K and the toolbar still open it). A per-user preference kept in
 * this browser: the engine has no store for user preferences.
 */
export type NLBarMode = 'pinned' | 'collapsed' | 'hidden';

export const NL_BAR_MODES: readonly NLBarMode[] = ['pinned', 'collapsed', 'hidden'];

const DEFAULT_MODE: NLBarMode = 'pinned';
const KEY_PREFIX = 'abada.nlBar';

const isMode = (value: unknown): value is NLBarMode =>
  typeof value === 'string' && (NL_BAR_MODES as readonly string[]).includes(value);

/** One key per signed-in user, so people sharing a browser keep their own choice. */
export function nlBarStorageKey(): string {
  const user = getUserFromToken(keycloak.tokenParsed)?.id;
  return user ? `${KEY_PREFIX}.${user}` : KEY_PREFIX;
}

let current: { key: string; mode: NLBarMode } | null = null;
const listeners = new Set<() => void>();

export function readNLBarMode(): NLBarMode {
  const key = nlBarStorageKey();
  if (current?.key === key) return current.mode;
  let mode = DEFAULT_MODE;
  try {
    const stored = window.localStorage.getItem(key);
    if (isMode(stored)) mode = stored;
  } catch {
    // Blocked storage: the default applies.
  }
  current = { key, mode };
  return mode;
}

export function writeNLBarMode(mode: NLBarMode): void {
  const key = nlBarStorageKey();
  current = { key, mode };
  try {
    window.localStorage.setItem(key, mode);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useNLBarMode(): [NLBarMode, (mode: NLBarMode) => void] {
  const mode = useSyncExternalStore(subscribe, readNLBarMode, () => DEFAULT_MODE);
  return [mode, writeNLBarMode];
}

/** Tests only: forget the cached preference so the next read goes back to storage. */
export function resetNLBarModeForTests(): void {
  current = null;
}

/** ⌘K on macOS, Ctrl+K elsewhere: opens the bar whatever its display mode. */
export function isNLBarShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k';
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent);
/** How the shortcut is written on this platform. */
export const NL_BAR_SHORTCUT_LABEL = isMac ? '⌘K' : 'Ctrl K';
