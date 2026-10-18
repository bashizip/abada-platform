import React, { useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  NODE_KINDS, NODE_KIND_MIME, PALETTE_GROUPS, kindAccent, type NodeKind,
} from '@/features/designer/nodes/nodeCatalog';
import { NodeGlyph } from '@/features/designer/nodes/shapes';

/**
 * The node palette: every kind drawn as it appears on the canvas, grouped,
 * searchable, and added by click, Enter or drag onto the canvas.
 */
export const NodePalette: React.FC<{ onAddNode: (kind: NodeKind) => void }> = ({ onAddNode }) => {
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => NODE_KINDS.filter((spec) => !needle
    || `${spec.label} ${spec.description} ${spec.aplType} ${spec.keywords}`.toLowerCase().includes(needle)), [needle]);

  /** Arrow keys move between entries, as in a menu. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-kind]') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = at < 0 ? 0 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div className="space-y-3" onKeyDown={onKeyDown}>
      <label className="flex items-center gap-2 rounded-xl border border-hairline bg-charcoal px-2.5 py-1.5 focus-within:border-saffron">
        <Search className="h-3.5 w-3.5 shrink-0 text-sand" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && visible.length > 0) onAddNode(visible[0].kind);
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder="Find a node…"
          aria-label="Find a node"
          className="min-w-0 flex-1 bg-transparent text-xs text-linen placeholder:text-sand-dim focus:outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="text-sand hover:text-linen">
            <X className="h-3 w-3" />
          </button>
        )}
      </label>
      <p className="text-[10px] leading-relaxed text-sand">
        Click to add after the selected node, or drag onto the canvas.
      </p>

      <div ref={list} className="space-y-3">
        {PALETTE_GROUPS.map((group) => {
          const entries = visible.filter((spec) => spec.group === group);
          if (!entries.length) return null;
          return (
            <section key={group} aria-label={group} className="space-y-1">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-sand/80">{group}</h3>
              {entries.map((spec) => (
                <button
                  key={spec.kind}
                  type="button"
                  data-kind={spec.kind}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(NODE_KIND_MIME, spec.kind);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAddNode(spec.kind)}
                  title={`${spec.label} — ${spec.description} (APL ${spec.aplType})`}
                  className="group flex w-full cursor-grab items-center gap-3 rounded-xl border border-transparent px-2 py-1.5 text-left transition-colors duration-[var(--duration-fast)] hover:border-hairline hover:bg-charcoal focus-visible:border-saffron focus-visible:bg-charcoal focus-visible:outline-none active:cursor-grabbing"
                >
                  <span className="flex w-11 shrink-0 items-center justify-center">
                    <NodeGlyph kind={spec.kind} size={26} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-linen">{spec.label}</span>
                    <span className="block text-[10px] leading-snug text-sand line-clamp-2">{spec.description}</span>
                  </span>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100"
                    style={{ background: kindAccent(spec.kind) }} aria-hidden="true" />
                </button>
              ))}
            </section>
          );
        })}
        {visible.length === 0 && (
          <p className="rounded-xl border border-hairline bg-charcoal p-3 text-center text-[11px] text-sand">
            No node matches “{query}”.
          </p>
        )}
      </div>
    </div>
  );
};
