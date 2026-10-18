import React, { useCallback, useEffect, useRef } from 'react';
import { INSPECTOR_PANEL_DEFAULT_WIDTH, useInspectorPanelPrefs } from '@/lib/run/panelPrefs';

/**
 * The column the audit trail lives in, docked right of the canvas. Its width
 * is shared with the designer's live view and persists; drag the left edge
 * to resize, double-click to reset.
 */
export const AuditTrailColumn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { panelWidth, setPanelWidth } = useInspectorPanelPrefs();
  const handlers = useRef<{ move: (event: MouseEvent) => void; up: () => void } | null>(null);

  const endResize = useCallback(() => {
    if (!handlers.current) return;
    window.removeEventListener('mousemove', handlers.current.move);
    window.removeEventListener('mouseup', handlers.current.up);
    handlers.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    handlers.current = {
      // Moving left widens the column.
      move: (move: MouseEvent) => setPanelWidth(Math.min(760, Math.max(340, startWidth + startX - move.clientX))),
      up: endResize,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handlers.current.move);
    window.addEventListener('mouseup', handlers.current.up);
  };

  // Unmounting mid-drag (Esc → back) releases the listeners and body styles.
  useEffect(() => endResize, [endResize]);

  return (
    <aside aria-label="Audit trail" style={{ width: panelWidth }}
      className="relative flex min-h-0 shrink-0 flex-col border-l border-hairline bg-mocha-deep max-md:!w-full max-md:border-l-0 max-md:border-t">
      <div role="separator" aria-orientation="vertical" aria-label="Resize the audit trail"
        onMouseDown={startResize} onDoubleClick={() => setPanelWidth(INSPECTOR_PANEL_DEFAULT_WIDTH)}
        title="Drag to resize · double-click to reset"
        className="group absolute -left-1.5 top-0 z-20 h-full w-3 cursor-col-resize max-md:hidden">
        <div className="mx-auto h-full w-px bg-hairline transition-colors group-hover:bg-saffron" />
      </div>
      {children}
    </aside>
  );
};
