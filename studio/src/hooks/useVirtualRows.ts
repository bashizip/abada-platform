import { useCallback, useEffect, useState } from 'react';

/** Height the window assumes before the scroller has been measured (and in tests). */
export const FALLBACK_VIEWPORT = 640;

/**
 * Fixed-height windowing: only the rows in view (plus `overscan` above and
 * below) are rendered, so a list of 1 000 instances costs a few dozen rows.
 */
export function useVirtualRows(count: number, rowHeight: number, scroller: HTMLElement | null, overscan = 6) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);

  useEffect(() => {
    if (!scroller) return;
    const measure = () => setViewport(scroller.clientHeight || FALLBACK_VIEWPORT);
    measure();
    const onScroll = () => setScrollTop(scroller.scrollTop);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [scroller]);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);

  /** Scrolls the least needed to bring row `index` fully into view. */
  const reveal = useCallback((index: number) => {
    if (!scroller) return;
    const top = index * rowHeight;
    const height = scroller.clientHeight || FALLBACK_VIEWPORT;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + rowHeight > scroller.scrollTop + height) scroller.scrollTop = top + rowHeight - height;
  }, [scroller, rowHeight]);

  return { start, end, totalHeight: count * rowHeight, reveal };
}
