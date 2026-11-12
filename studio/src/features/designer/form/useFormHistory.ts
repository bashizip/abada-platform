import { useCallback, useRef, useState } from 'react';
import type { FormSchema } from '@/features/inbox/formSchema';

/** Typing in one property within this window is one undo step, as on the canvas. */
export const COALESCE_MS = 800;
export const HISTORY_LIMIT = 100;

interface History {
  past: FormSchema[];
  present: FormSchema;
  future: FormSchema[];
  lastKey?: string;
  lastAt: number;
}

/** Undo/redo for the form designer: snapshots of the schema, coalescing edits to the same property. */
export function useFormHistory(initial: FormSchema) {
  const [history, setHistory] = useState<History>({ past: [], present: initial, future: [], lastAt: 0 });
  const now = useRef(() => Date.now());

  const set = useCallback((next: FormSchema, coalesceKey?: string) => {
    setHistory((h) => {
      if (next === h.present) return h;
      const at = now.current();
      const merge = coalesceKey !== undefined && coalesceKey === h.lastKey && at - h.lastAt < COALESCE_MS;
      return {
        past: merge ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
        lastKey: coalesceKey,
        lastAt: at,
      };
    });
  }, []);

  const undo = useCallback(() => setHistory((h) => (h.past.length === 0 ? h : {
    past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastAt: 0,
  })), []);

  const redo = useCallback(() => setHistory((h) => (h.future.length === 0 ? h : {
    past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastAt: 0,
  })), []);

  const reset = useCallback((schema: FormSchema) => setHistory({ past: [], present: schema, future: [], lastAt: 0 }), []);

  return {
    schema: history.present,
    set,
    undo,
    redo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
