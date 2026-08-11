import { useEffect, useRef, useState } from 'react';

/**
 * Shared inspector panel layout preferences (width + pin state) used by both
 * the live canvas inspector and the full-screen instance detail view. The two
 * views read and write the same localStorage keys, so a layout choice made in
 * one is remembered — and restored — by the other.
 */
export const INSPECTOR_PANEL_DEFAULT_WIDTH = 440;
const INSPECTOR_PANEL_MIN_WIDTH = 340;
const INSPECTOR_PANEL_MAX_WIDTH = 760;
export const INSPECTOR_PANEL_WIDTH_KEY = 'abada.studio.inspectorPanelWidth';
export const INSPECTOR_PANEL_PINNED_KEY = 'abada.studio.inspectorPanelPinned';

/** Legacy per-view keys, kept for a one-time read-side migration. */
const LEGACY_WIDTH_KEYS = ['abada.studio.livePanelWidth', 'abada.studio.detailPanelWidth'];
const LEGACY_PINNED_KEYS = ['abada.studio.livePanelPinned', 'abada.studio.detailPanelPinned'];

const readStoredNumber = (key: string, legacyKeys: string[]): number | null => {
  try {
    const direct = localStorage.getItem(key);
    if (direct !== null) {
      const parsed = Number.parseInt(direct, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    for (const legacy of legacyKeys) {
      const value = localStorage.getItem(legacy);
      if (value !== null) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  } catch {
    // Storage unavailable (e.g. privacy mode) — fall back to the default.
  }
  return null;
};

export const readInspectorPanelWidth = (): number => {
  const stored = readStoredNumber(INSPECTOR_PANEL_WIDTH_KEY, LEGACY_WIDTH_KEYS);
  if (stored === null) return INSPECTOR_PANEL_DEFAULT_WIDTH;
  return Math.min(INSPECTOR_PANEL_MAX_WIDTH, Math.max(INSPECTOR_PANEL_MIN_WIDTH, stored));
};

export const readInspectorPanelPinned = (): boolean => {
  try {
    const direct = localStorage.getItem(INSPECTOR_PANEL_PINNED_KEY);
    if (direct !== null) return direct === 'true';
    for (const legacy of LEGACY_PINNED_KEYS) {
      const value = localStorage.getItem(legacy);
      if (value !== null) return value === 'true';
    }
  } catch {
    // Storage unavailable — fall back to pinned.
  }
  return true;
};

/**
 * React state bound to the shared preferences: initializes from localStorage
 * (with legacy-key migration) and persists back on change. Width writes are
 * debounced because resize drags fire on every mousemove; pinned only changes
 * on click, so it is written immediately.
 */
export function useInspectorPanelPrefs() {
  const [panelWidth, setPanelWidth] = useState<number>(readInspectorPanelWidth);
  const [pinned, setPinned] = useState<boolean>(readInspectorPanelPinned);

  // Track the latest width for the debounced writer and its unmount flush.
  const widthRef = useRef(panelWidth);
  widthRef.current = panelWidth;
  const widthTimer = useRef<number | null>(null);

  useEffect(() => {
    if (widthTimer.current !== null) window.clearTimeout(widthTimer.current);
    widthTimer.current = window.setTimeout(() => {
      widthTimer.current = null;
      try { localStorage.setItem(INSPECTOR_PANEL_WIDTH_KEY, String(widthRef.current)); } catch { /* ignore */ }
    }, 250);
    return () => {
      if (widthTimer.current !== null) window.clearTimeout(widthTimer.current);
      widthTimer.current = null;
    };
  }, [panelWidth]);

  // Switching views unmounts this hook's component (live canvas <-> full-screen
  // detail). Flush any pending debounced width synchronously so the last drag
  // update is never dropped when the other view reads it back on mount.
  useEffect(() => {
    return () => {
      if (widthTimer.current !== null) {
        window.clearTimeout(widthTimer.current);
        try { localStorage.setItem(INSPECTOR_PANEL_WIDTH_KEY, String(widthRef.current)); } catch { /* ignore */ }
        widthTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(INSPECTOR_PANEL_PINNED_KEY, String(pinned)); } catch { /* ignore */ }
  }, [pinned]);

  return { panelWidth, setPanelWidth, pinned, setPinned };
}
