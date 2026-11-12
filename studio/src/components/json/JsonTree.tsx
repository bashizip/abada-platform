import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useVirtualRows } from '@/hooks/useVirtualRows';
import type { JsonNode } from './jsonModel';
import { MaskedText, JsonValue } from './JsonValue';
import { isOpen as nodeIsOpen, type TreeRow } from './jsonRows';
import type { JsonSearch } from './jsonSearch';
import { ROW_HEIGHT } from './jsonLayout';
import { useTreeKeyboard, type TreeKeyboardActions } from './useTreeKeyboard';

const INDENT = 14;
const GUIDES = 'repeating-linear-gradient(90deg, transparent 0 6px, var(--color-hairline) 6px 7px, transparent 7px 14px)';

export interface JsonTreeProps extends Omit<TreeKeyboardActions, 'isOpen'> {
  idPrefix: string;
  label: string;
  expanded: ReadonlySet<string>;
  openStrings: ReadonlySet<string>;
  search: JsonSearch | null;
  currentHit: JsonNode | null;
  /** Paths changed in the last update, and the containers holding them. */
  changed: ReadonlySet<string>;
  changedInside: ReadonlySet<string>;
  flashing: boolean;
  height?: number;
  onScroller?: (element: HTMLDivElement | null) => void;
}

/** The variables (or any JSON value) as a windowed, keyboard-navigable tree. */
export const JsonTree: React.FC<JsonTreeProps> = (props) => {
  const { rows, active, onActive, idPrefix, label, expanded, openStrings, search, currentHit, changed, changedInside, flashing, height } = props;
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const { start, end, totalHeight, reveal } = useVirtualRows(rows.length, ROW_HEIGHT, scroller, 8);
  const isOpen = (node: JsonNode) => nodeIsOpen(node, expanded, search);
  const onKeyDown = useTreeKeyboard({ ...props, isOpen });
  useEffect(() => { reveal(active); }, [active, reveal]);

  const roots = rows.filter((row) => !row.node.parent && row.continuation === undefined).map((row) => row.node);

  const renderRow = (row: TreeRow, index: number) => {
    const { node } = row;
    const indent = <span aria-hidden="true" className="h-full shrink-0" style={{ width: node.depth * INDENT + 4, backgroundImage: GUIDES }} />;
    if (row.continuation !== undefined) {
      return (
        <div key={`${node.path}~${index}`} role="none" className="flex items-center whitespace-pre pr-2" style={{ height: ROW_HEIGHT }}>
          {indent}<span className="w-4 shrink-0" />
          <span className="text-sage-green"><MaskedText text={row.continuation} query={search?.query} /></span>
        </div>
      );
    }
    const open = isOpen(node);
    const isActive = index === active;
    const isChanged = changed.has(node.path);
    const current = currentHit === node;
    const siblings = node.parent?.children ?? roots;
    const size = siblings.length;
    const position = siblings.indexOf(node) + 1;
    return (
      <div key={node.path} id={`${idPrefix}-row-${index}`} role="treeitem" aria-level={node.depth + 1}
        aria-setsize={size} aria-posinset={position} aria-expanded={node.children ? open : undefined} aria-selected={isActive}
        onClick={() => onActive(index)}
        className={`group relative flex items-center whitespace-nowrap pr-2 ${isActive ? 'bg-mocha shadow-[inset_2px_0_0_var(--color-saffron)]' : 'hover:bg-mocha-hover/50'} ${
          isChanged && flashing ? 'abada-json-flash' : ''}`}
        style={{ height: ROW_HEIGHT }}>
        {indent}
        <button type="button" tabIndex={-1} aria-hidden="true" onClick={(event) => { event.stopPropagation(); onActive(index); props.onToggle(node); }}
          className={`grid h-4 w-4 shrink-0 place-items-center text-sand transition-transform duration-[var(--duration-fast)] ${
            node.children && node.children.length > 0 ? '' : 'invisible'} ${open ? 'rotate-90' : ''}`}>
          <ChevronRight className="h-3 w-3" />
        </button>
        <span className={typeof node.key === 'number' ? 'text-sand/80' : 'text-sand'}>
          <MaskedText text={String(node.key)} query={search?.query} current={current} />
        </span>
        <span className="ml-px mr-1.5 text-sand-dim" aria-hidden="true">:</span>
        <span className="flex min-w-0 items-center overflow-hidden">
          <JsonValue node={node} open={open} stringOpen={openStrings.has(node.path)} query={search?.query} current={current}
            onToggleString={() => props.onToggleString(node)} />
        </span>
        {isChanged && <span className="ml-2 h-1.5 w-1.5 shrink-0 rounded-full bg-saffron" title="Changed in the last update"><span className="sr-only">changed in the last update</span></span>}
        {!isChanged && !open && changedInside.has(node.path) && (
          <span className="ml-2 h-1.5 w-1.5 shrink-0 rounded-full bg-saffron/50" title="Holds a change from the last update" />
        )}
        <span className={`ml-auto flex shrink-0 gap-1 pl-3 font-sans transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <button type="button" tabIndex={-1} disabled={node.kind === 'redacted'} onClick={(event) => { event.stopPropagation(); props.onCopyValue(node); }}
            className="rounded border border-hairline bg-charcoal px-1.5 text-[10.5px] leading-4 text-sand hover:border-hairline-strong hover:text-linen disabled:opacity-40">
            Copy value
          </button>
          <button type="button" tabIndex={-1} onClick={(event) => { event.stopPropagation(); props.onCopyPath(node); }}
            className="rounded border border-hairline bg-charcoal px-1.5 text-[10.5px] leading-4 text-sand hover:border-hairline-strong hover:text-linen">
            Copy path
          </button>
        </span>
      </div>
    );
  };

  return (
    <div ref={(element) => { setScroller(element); props.onScroller?.(element); }} role="tree" aria-label={label} tabIndex={0}
      aria-activedescendant={rows[active]?.continuation === undefined && rows.length ? `${idPrefix}-row-${active}` : undefined}
      onKeyDown={onKeyDown}
      className={`relative overflow-auto overscroll-contain font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-saffron ${height ? '' : 'max-h-[75vh] min-h-0 flex-1'}`}
      style={height ? { height } : undefined}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
          {rows.slice(start, end).map((row, offset) => renderRow(row, start + offset))}
        </div>
      </div>
    </div>
  );
};
