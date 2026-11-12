import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copies text from a click handler (where browsers allow it), falling back to
 * a hidden textarea, and keeps a short status line for the viewer to show.
 */
export function useClipboard(clearAfterMs = 2000) {
  const [status, setStatus] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = useCallback((message: string) => {
    setStatus(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(null), clearAfterMs);
  }, [clearAfterMs]);

  const copy = useCallback((text: string, message: string) => {
    const fallback = () => {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      area.remove();
      show(copied ? message : 'Copy is blocked here; select the text instead');
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => show(message), fallback);
    else fallback();
  }, [show]);

  return { copy, status };
}
