import { useCallback, useEffect, useState } from 'react';

export interface OperationsNotice {
  message: string;
  tone?: 'success' | 'error';
  /** One follow-up, e.g. "View in audit trail". */
  action?: { label: string; run: () => void };
}

/** The Operations views' notice: one at a time, bottom right, with an optional action. */
export function useOperationsNotice(): [OperationsNotice | null, (notice: OperationsNotice | null) => void] {
  const [notice, setNotice] = useState<OperationsNotice | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.action ? 6000 : 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return [notice, useCallback((next: OperationsNotice | null) => setNotice(next), [])];
}
