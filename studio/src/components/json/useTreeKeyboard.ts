import { useCallback } from 'react';
import type React from 'react';
import type { JsonNode } from './jsonModel';
import { isLongString, rowIndexOf, type TreeRow } from './jsonRows';

export interface TreeKeyboardActions {
  rows: TreeRow[];
  active: number;
  isOpen: (node: JsonNode) => boolean;
  onActive: (index: number) => void;
  onToggle: (node: JsonNode) => void;
  onToggleString: (node: JsonNode) => void;
  onExpandSiblings: (node: JsonNode) => void;
  onCopyValue: (node: JsonNode) => void;
  onCopyPath: (node: JsonNode) => void;
  onSearch?: () => void;
}

/** The nearest row from `index` in direction `step` that shows a node (not a wrapped line). */
function nodeRow(rows: TreeRow[], index: number, step: 1 | -1): number {
  let at = index;
  while (rows[at] && rows[at].continuation !== undefined) at += step;
  return rows[at] ? at : -1;
}

/**
 * The WAI-ARIA tree keys on one focusable element (`aria-activedescendant`, so
 * windowing never loses focus): ↑ ↓ Home End move, → opens or enters, ← closes
 * or goes to the parent, `*` opens the siblings, Enter/Space toggles, `c` and
 * `p` copy the value and the path, `/` jumps to the search box.
 */
export function useTreeKeyboard(actions: TreeKeyboardActions) {
  const { rows, active, isOpen, onActive, onToggle, onToggleString, onExpandSiblings, onCopyValue, onCopyPath, onSearch } = actions;
  return useCallback((event: React.KeyboardEvent) => {
    if (rows.length === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const node = rows[active]?.node;
    if (!node) return;
    const move = (index: number) => { if (index >= 0) onActive(index); };
    switch (event.key) {
      case 'ArrowDown': move(nodeRow(rows, Math.min(rows.length - 1, active + 1), 1)); break;
      case 'ArrowUp': move(nodeRow(rows, Math.max(0, active - 1), -1)); break;
      case 'Home': move(0); break;
      case 'End': move(nodeRow(rows, rows.length - 1, -1)); break;
      case 'ArrowRight':
        if (node.children && node.children.length > 0) {
          if (!isOpen(node)) onToggle(node);
          else move(nodeRow(rows, active + 1, 1));
        }
        break;
      case 'ArrowLeft':
        if (node.children && isOpen(node)) onToggle(node);
        else if (node.parent) move(rowIndexOf(rows, node.parent));
        break;
      case '*': onExpandSiblings(node); break;
      case 'Enter':
      case ' ':
        if (node.children) onToggle(node);
        else if (isLongString(node)) onToggleString(node);
        break;
      case 'c': onCopyValue(node); break;
      case 'p': onCopyPath(node); break;
      case '/': if (!onSearch) return; onSearch(); break;
      default: return;
    }
    event.preventDefault();
  }, [rows, active, isOpen, onActive, onToggle, onToggleString, onExpandSiblings, onCopyValue, onCopyPath, onSearch]);
}
