import React, { useEffect, useRef, useState } from 'react';
import { PanelLeftOpen, PanelRightOpen, Pin, PinOff, X } from 'lucide-react';
import { type SidePanelBounds, useSidePanelPrefs } from '@/lib/layout/sidePanelPrefs';

interface SidePanelProps {
  /** Remembers this panel's width and pin state under its own key. */
  id: string;
  side: 'left' | 'right';
  label: string;
  bounds: SidePanelBounds;
  children: React.ReactNode;
}

const KEYBOARD_STEP = 16;

/**
 * A designer side panel the user can resize and pin. Pinned, it sits beside the canvas. Unpinned, it folds
 * into a narrow rail so the canvas takes the room, and opens over the canvas from that rail when needed.
 */
export const SidePanel: React.FC<SidePanelProps> = ({ id, side, label, bounds, children }) => {
  const { width, setWidth, pinned, setPinned } = useSidePanelPrefs(id, bounds);
  const [open, setOpen] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (pinned || !open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned, open]);

  // Dragging toward the canvas widens the panel.
  const widthAt = (clientX: number) => {
    const { startX, startWidth } = drag.current!;
    return startWidth + (side === 'left' ? clientX - startX : startX - clientX);
  };

  const endDrag = () => {
    drag.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  useEffect(() => endDrag, []);

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuenow={width}
      aria-valuemin={bounds.minWidth}
      aria-valuemax={bounds.maxWidth}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className={`group absolute top-0 z-20 h-full w-3 cursor-col-resize focus:outline-none ${
        side === 'left' ? '-right-1.5' : '-left-1.5'}`}
      onPointerDown={(event) => {
        event.preventDefault();
        drag.current = { startX: event.clientX, startWidth: width };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onPointerMove={(event) => { if (drag.current) setWidth(widthAt(event.clientX)); }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => setWidth(bounds.defaultWidth)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const towardCanvas = (event.key === 'ArrowRight') === (side === 'left');
        setWidth(width + (towardCanvas ? KEYBOARD_STEP : -KEYBOARD_STEP));
      }}
    >
      <div className="mx-auto h-full w-px bg-hairline transition-colors group-hover:bg-saffron group-focus-visible:bg-saffron" />
    </div>
  );

  const pinLabel = pinned ? `Unpin ${label} to give the canvas more room` : `Pin ${label} beside the canvas`;
  const header = (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-hairline bg-charcoal/80 px-2">
      <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-moss">{label}</span>
      <button type="button" onClick={() => { setPinned(!pinned); setOpen(false); }}
        aria-pressed={pinned} aria-label={pinLabel} title={pinLabel}
        className={`ml-auto flex h-5 w-5 items-center justify-center rounded transition-colors ${pinned
          ? 'text-mineral-teal hover:bg-mocha-hover' : 'text-sand hover:bg-mocha-hover hover:text-linen'}`}>
        {pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
      </button>
      {!pinned && (
        <button type="button" onClick={() => setOpen(false)} aria-label={`Close ${label}`} title={`Close ${label}`}
          className="flex h-5 w-5 items-center justify-center rounded text-sand hover:bg-mocha-hover hover:text-linen">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );

  const body = (
    <>
      {header}
      <div className="flex min-h-0 flex-1">{children}</div>
      {handle}
    </>
  );

  if (pinned) {
    return (
      <div data-panel={id} style={{ width }} className="relative flex h-full shrink-0 flex-col">
        {body}
      </div>
    );
  }

  const OpenIcon = side === 'left' ? PanelLeftOpen : PanelRightOpen;
  return (
    <div data-panel={id} className={`relative z-30 flex h-full w-8 shrink-0 flex-col items-center bg-mocha ${
      side === 'left' ? 'border-r' : 'border-l'} border-hairline`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        aria-label={open ? `Close ${label}` : `Open ${label}`} title={open ? `Close ${label}` : `Open ${label}`}
        className="flex w-full flex-col items-center gap-2 py-2 text-sand hover:bg-mocha-hover hover:text-linen">
        <OpenIcon className="h-4 w-4" />
        <span className="text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]">{label}</span>
      </button>
      {open && (
        <div style={{ width }} role="dialog" aria-label={label}
          className={`absolute top-0 flex h-full flex-col shadow-warm-lg ${side === 'left' ? 'left-full' : 'right-full'}`}>
          {body}
        </div>
      )}
    </div>
  );
};
