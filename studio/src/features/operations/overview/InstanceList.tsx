import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, SearchX, Workflow } from 'lucide-react';
import type { ProcessInstanceDTO } from '@/api/engine';
import { EmptyState, Skeleton } from '@/components/ui';
import { InstanceRow, ROW_GRID, ROW_HEIGHT, RowAction } from './InstanceRow';
import { useVirtualRows } from '@/hooks/useVirtualRows';

/** Rows from the end at which the next page loads. */
const LOAD_AHEAD = 12;

const isTyping = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  return !!element && (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable);
};

/**
 * `j`/`k` (or the arrows) move the cursor, `Enter` opens, `/` searches. Off
 * while typing or while a dialog or drawer is open.
 */
function useListKeyboard(count: number, cursor: number, setCursor: (index: number) => void,
  onOpen: (index: number) => void, onSearch: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const move = event.key === 'j' || event.key === 'ArrowDown' ? 1 : event.key === 'k' || event.key === 'ArrowUp' ? -1 : 0;
      if (move && count > 0) {
        event.preventDefault();
        setCursor(Math.max(0, Math.min(count - 1, cursor + move)));
      } else if (event.key === 'Enter' && count > 0 && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        onOpen(cursor);
      } else if (event.key === '/') {
        event.preventDefault();
        onSearch();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [count, cursor, setCursor, onOpen, onSearch]);
}

const HEADINGS = ['State', 'Instance', 'Process', 'Now at', 'Duration', 'Started', ''];

/** The instances, virtualised: only the rows in view are in the page. */
export const InstanceList: React.FC<{
  rows: ProcessInstanceDTO[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  emptyProject: boolean;
  filtered: boolean;
  cursor: number;
  onCursorChange: (index: number) => void;
  processOf: (instance: ProcessInstanceDTO) => { name: string; version: string };
  incidentInstanceIds: ReadonlySet<string>;
  canOperate: boolean;
  onAction: (action: RowAction, instance: ProcessInstanceDTO, index: number) => void;
  onSearch: () => void;
  emptyAction?: React.ReactNode;
}> = ({
  rows, loading, loadingMore, hasMore, onLoadMore, emptyProject, filtered, cursor, onCursorChange, processOf,
  incidentInstanceIds, canOperate, onAction, onSearch, emptyAction,
}) => {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const { start, end, totalHeight, reveal } = useVirtualRows(rows.length, ROW_HEIGHT, scroller);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { reveal(cursor); }, [cursor, reveal]);
  /* Arriving on the list (from the navigation or back from an instance): focus it, so j/k/Enter work at once. */
  const focused = useRef(false);
  useEffect(() => {
    if (!scroller || focused.current) return;
    focused.current = true;
    const active = document.activeElement;
    if (!isTyping(active) && !document.querySelector('[aria-modal="true"]')) scroller.focus({ preventScroll: true });
  }, [scroller]);
  useEffect(() => {
    if (hasMore && !loadingMore && end >= rows.length - LOAD_AHEAD) onLoadMore();
  }, [end, rows.length, hasMore, loadingMore, onLoadMore]);
  useListKeyboard(rows.length, cursor, onCursorChange,
    (index) => { if (rows[index]) onAction('open', rows[index], index); }, onSearch);

  const body = loading && rows.length === 0 ? (
    <div className="space-y-3.5 px-4 py-3"><Skeleton lines={8} className="h-6 w-full" label="Loading instances" /></div>
  ) : rows.length === 0 ? (
    emptyProject ? (
      <EmptyState className="flex-1" icon={<Workflow className="h-8 w-8" />}
        title="No process has run in this project yet"
        description="Deploy a process from the designer and start it. Each run appears here the moment it starts, and you can watch it step by step."
        action={emptyAction} />
    ) : (
      <EmptyState className="flex-1" icon={<SearchX className="h-8 w-8" />}
        title={filtered ? 'No instance matches these filters' : 'No instances'}
        description={filtered ? 'Widen the time range, clear the search or pick another state.' : undefined} />
    )
  ) : (
    <div ref={setScroller} tabIndex={-1} aria-label="Instance list"
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none">
      <div role="list" aria-label="Instances" style={{ height: totalHeight }} className="relative">
        {rows.slice(start, end).map((instance, offset) => (
          <InstanceRow key={instance.id} instance={instance} index={start + offset}
            process={processOf(instance)} hasIncident={incidentInstanceIds.has(instance.id)}
            cursor={start + offset === cursor} canOperate={canOperate} now={now} onAction={onAction} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-panel border border-hairline bg-mocha-deep">
      <div aria-hidden="true" className={`${ROW_GRID} h-9 shrink-0 border-b border-hairline text-[10px] font-semibold uppercase tracking-[0.12em] text-sand`}>
        {HEADINGS.map((heading, index) => <span key={index}>{heading}</span>)}
      </div>
      {body}
      {rows.length > 0 && (
        <div className="flex shrink-0 items-center gap-4 border-t border-hairline px-4 py-2 text-[11px] text-sand">
          {loadingMore ? (
            <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Loading more…</span>
          ) : hasMore ? (
            <button type="button" onClick={onLoadMore} className="font-semibold text-sand hover:text-linen">Load more</button>
          ) : (
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-sage-green" aria-hidden="true" /> All loaded</span>
          )}
          <span className="ml-auto hidden sm:inline">
            <kbd className="rounded border border-hairline px-1 font-mono">j</kbd> <kbd className="rounded border border-hairline px-1 font-mono">k</kbd> move ·{' '}
            <kbd className="rounded border border-hairline px-1 font-mono">Enter</kbd> open ·{' '}
            <kbd className="rounded border border-hairline px-1 font-mono">/</kbd> search
          </span>
        </div>
      )}
    </div>
  );
};
