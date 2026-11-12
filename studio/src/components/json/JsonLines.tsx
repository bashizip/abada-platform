import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useVirtualRows } from '@/hooks/useVirtualRows';
import type { JsonNode } from './jsonModel';
import { MaskedText, RedactedBadge } from './JsonValue';
import { ROW_HEIGHT as LINE_HEIGHT, VALUE_TONE } from './jsonLayout';
import type { JsonTokenKind, VisibleJsonLine } from './jsonTokenize';

const TOKEN_TONE: Record<JsonTokenKind, string> = {
  key: 'text-sand',
  punct: 'text-sand-dim',
  string: VALUE_TONE.string,
  number: VALUE_TONE.number,
  boolean: VALUE_TONE.boolean,
  null: VALUE_TONE.null,
  redacted: '',
};

/** The whole value as formatted JSON: line numbers, folding, highlighting; windowed. */
export const JsonLines: React.FC<{
  lines: VisibleJsonLine[];
  label: string;
  query?: string;
  currentHit: JsonNode | null;
  changed: ReadonlySet<string>;
  flashing: boolean;
  /** A line to bring into view (index in `lines`). */
  revealIndex: number;
  height?: number;
  onFold: (path: string) => void;
}> = ({ lines, label, query, currentHit, changed, flashing, revealIndex, height, onFold }) => {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const { start, end, totalHeight, reveal } = useVirtualRows(lines.length, LINE_HEIGHT, scroller, 8);
  useEffect(() => { if (revealIndex >= 0) reveal(revealIndex); }, [revealIndex, reveal]);
  const gutter = String(lines.at(-1)?.number ?? 1).length;

  return (
    <div ref={setScroller} role="region" aria-label={label} tabIndex={0}
      className={`relative overflow-auto overscroll-contain font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-saffron ${height ? '' : 'max-h-[75vh] min-h-0 flex-1'}`}
      style={height ? { height } : undefined}>
      <div style={{ height: totalHeight, position: 'relative', minWidth: 'max-content' }}>
        <div style={{ transform: `translateY(${start * LINE_HEIGHT}px)` }}>
          {lines.slice(start, end).map((line) => {
            const node = line.node;
            const foldable = line.foldEnd !== undefined && node;
            const current = !!node && node === currentHit;
            return (
              <div key={line.number} data-line={line.number}
                className={`flex items-center whitespace-pre hover:bg-mocha-hover/40 ${flashing && node && changed.has(node.path) ? 'abada-json-flash' : ''}`}
                style={{ height: LINE_HEIGHT }}>
                <span className="sticky left-0 z-[1] shrink-0 bg-charcoal pl-2 pr-1.5 text-right tabular-nums text-sand-dim select-none"
                  style={{ width: `${gutter + 2}ch` }} aria-hidden="true">{line.number}</span>
                {foldable ? (
                  <button type="button" onClick={() => onFold(node.path)} aria-expanded={!line.folded}
                    aria-label={`${line.folded ? 'Unfold' : 'Fold'} ${node.path}`}
                    className="sticky z-[1] grid h-4 w-4 shrink-0 place-items-center bg-charcoal text-sand hover:text-linen"
                    style={{ left: `${gutter + 2}ch` }}>
                    {line.folded ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                ) : <span className="w-4 shrink-0" />}
                <span className="pl-1.5 pr-4">
                  {'  '.repeat(line.depth)}
                  {(line.folded ? line.tokens.slice(0, -1) : line.tokens).map((token, index) => token.kind === 'redacted'
                    ? <RedactedBadge key={index} />
                    : (
                      <span key={index} className={TOKEN_TONE[token.kind]}>
                        {token.kind === 'punct' ? token.text : <MaskedText text={token.text} query={query} current={current} />}
                      </span>
                    ))}
                  {line.folded && node && (
                    <>
                      <button type="button" onClick={() => onFold(node.path)}
                        className="mx-0.5 rounded border border-hairline bg-mocha-deep px-1 font-sans text-[11px] text-sand hover:text-linen">
                        {line.folded.kind === 'array' ? '[…]' : '{…}'} {line.folded.count} {line.folded.kind === 'array' ? 'items' : 'keys'}
                      </button>
                      <span className="text-sand-dim">{line.folded.comma ? ',' : ''}</span>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
