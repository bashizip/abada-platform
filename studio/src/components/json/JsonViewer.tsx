import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import { copyableValue, type JsonNode } from './jsonModel';
import { JsonTree } from './JsonTree';
import { JsonLines } from './JsonLines';
import { useClipboard } from './useClipboard';
import { useJsonViewState } from './useJsonViewState';

const EMPTY: ReadonlySet<string> = new Set();

export interface JsonViewerProps {
  /** The value to show: a variable map, a payload, any JSON. */
  data: unknown;
  /** What the entries are called ("variables", "arguments"): labels, empty state, counts. */
  label?: string;
  loading?: boolean;
  /** No search, level picker or footer: for payloads inside cards and audit entries. */
  compact?: boolean;
  /** Fixed height in px; without it the viewer fills its flex parent. */
  height?: number;
  /** Levels opened when the data first arrives. */
  defaultDepth?: number;
  /** Paths changed in the last update: they flash once and keep a dot. */
  changedPaths?: ReadonlySet<string>;
  /** Bumped to flash the same set again. */
  changeKey?: number;
  /** Shown above the tree (e.g. that the playback is behind). */
  notice?: React.ReactNode;
  className?: string;
}

const toolButton = 'rounded-control border border-hairline bg-charcoal px-2 py-0.5 text-[11px] font-medium text-sand hover:border-hairline-strong hover:text-linen';

/**
 * Every piece of JSON in the Studio (M5 S11): a tree with counts, search,
 * copy value / copy path, long strings cut with *show more*, and a JSON view
 * with line numbers and folding. One 12 px monospace size for keys and
 * values. Masked values render as a badge and never as text.
 */
export const JsonViewer: React.FC<JsonViewerProps> = ({
  data, label = 'values', loading = false, compact = false, height, defaultDepth = 1,
  changedPaths = EMPTY, changeKey, notice, className = '',
}) => {
  const idPrefix = useId().replace(/:/g, '');
  const view = useJsonViewState(data, { defaultDepth, changed: changedPaths, changeKey });
  const { copy, status } = useClipboard();
  const searchRef = useRef<HTMLInputElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const { setWidth } = view;

  useEffect(() => {
    if (!scroller || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => setWidth(scroller.clientWidth || 600));
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller, setWidth]);

  const copyValue = (node: JsonNode) => {
    const text = copyableValue(node);
    if (text !== null) copy(text, `Copied the value of ${node.path}`);
  };
  const levels = view.tree.maxDepth + 1;
  const empty = !loading && view.tree.roots.length === 0;
  const hits = view.search?.hits.length ?? 0;
  const changedList = useMemo(() => [...changedPaths], [changedPaths]);

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-card border border-hairline bg-charcoal ${height ? '' : 'flex-1'} ${className}`}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline bg-mocha-deep px-2 py-1.5">
        <div role="group" aria-label="View" className="inline-flex rounded-control border border-hairline bg-charcoal p-0.5">
          {(['tree', 'json'] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={view.mode === mode} onClick={() => view.setMode(mode)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${view.mode === mode ? 'bg-mocha-hover text-linen' : 'text-sand hover:text-linen'}`}>
              {mode === 'tree' ? 'Tree' : 'JSON'}
            </button>
          ))}
        </div>
        {!compact && (
          <label className="relative min-w-[10rem] max-w-xs flex-1">
            <span className="sr-only">Search keys and values</span>
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-sand" aria-hidden="true" />
            <input ref={searchRef} type="search" value={view.query} placeholder="Search keys and values"
              onChange={(event) => view.setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); view.moveHit(event.shiftKey ? -1 : 1); }
                if (event.key === 'Escape' && view.query) { event.stopPropagation(); view.setQuery(''); }
              }}
              className="w-full rounded-control border border-hairline bg-charcoal py-1 pl-6 pr-2 text-[11px] text-linen placeholder-sand outline-none focus:border-saffron" />
          </label>
        )}
        {view.search && (
          <span className="inline-flex items-center gap-0.5 text-[11px] tabular-nums text-sand">
            <span aria-live="polite">{hits ? `${view.hitIndex + 1} of ${hits}` : 'No match'}</span>
            <button type="button" aria-label="Previous match" onClick={() => view.moveHit(-1)} disabled={!hits} className={`${toolButton} px-1`}><ArrowUp className="h-3 w-3" /></button>
            <button type="button" aria-label="Next match" onClick={() => view.moveHit(1)} disabled={!hits} className={`${toolButton} px-1`}><ArrowDown className="h-3 w-3" /></button>
          </span>
        )}
        <span className="flex-1" />
        <span role="status" className="text-[11px] text-sand">{status}</span>
        <button type="button" className={toolButton} onClick={view.expandAll} disabled={empty}>Expand all</button>
        <button type="button" className={toolButton} onClick={view.collapseAll} disabled={empty}>Collapse all</button>
        {!compact && levels > 1 && (
          <select aria-label="Expand to level" value="" className={toolButton}
            onChange={(event) => { if (event.target.value) view.expandTo(Number(event.target.value)); }}>
            <option value="">Level…</option>
            {Array.from({ length: levels }, (_, index) => <option key={index} value={index + 1}>Expand to level {index + 1}</option>)}
          </select>
        )}
        <button type="button" className={toolButton} disabled={empty} onClick={() => copy(JSON.stringify(data, null, 2), `Copied all ${label} as JSON`)}>Copy</button>
      </div>
      {notice && <div className="border-b border-saffron/30 bg-saffron/10 px-3 py-1.5 text-[11px] text-saffron">{notice}</div>}
      {!compact && changedList.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline px-3 py-1 text-[11px] text-sand">
          Changed in the last update:
          {changedList.map((path) => (
            <button key={path} type="button" onClick={() => view.revealPath(path)} disabled={!view.tree.byPath.has(path)}
              className="rounded bg-saffron/10 px-1.5 font-mono text-saffron hover:bg-saffron/20 disabled:line-through disabled:opacity-70"
              title={view.tree.byPath.has(path) ? `Show ${path}` : `${path} was removed`}>
              {path}
            </button>
          ))}
        </div>
      )}
      {loading ? (
        <div className="p-3"><Skeleton lines={6} label={`Reading ${label}`} /></div>
      ) : empty ? (
        <p className="px-4 py-6 text-center text-[11px] text-sand">No {label} yet.</p>
      ) : view.search && hits === 0 ? (
        <p className="px-4 py-6 text-center text-[11px] text-sand">No {label} match “{view.query}”.</p>
      ) : view.mode === 'tree' ? (
        <JsonTree idPrefix={idPrefix} label={label} rows={view.rows} active={view.active} onActive={view.setActive}
          expanded={view.expanded} openStrings={view.openStrings} search={view.search} currentHit={view.currentHit}
          changed={changedPaths} changedInside={view.changedInside} flashing={view.flashing} height={height}
          onToggle={view.toggle} onToggleString={view.toggleString} onExpandSiblings={view.expandSiblings}
          onCopyValue={copyValue} onCopyPath={(node) => copy(node.path, `Copied ${node.path}`)}
          onSearch={compact ? undefined : () => searchRef.current?.focus()} onScroller={setScroller} />
      ) : (
        <JsonLines lines={view.lines} label={`${label} as JSON`} query={view.search?.query} currentHit={view.currentHit}
          changed={changedPaths} flashing={view.flashing} revealIndex={view.lineTarget} height={height} onFold={view.fold} />
      )}
      {!compact && !loading && !empty && (
        <div className="flex flex-wrap gap-x-3 border-t border-hairline px-3 py-1 text-[10.5px] tabular-nums text-sand">
          <span>{view.tree.roots.length.toLocaleString()} {label}</span>
          <span>{view.tree.values.toLocaleString()} values</span>
          <span>{levels} {levels === 1 ? 'level' : 'levels'}</span>
        </div>
      )}
    </div>
  );
};
