import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildJsonTree, containersToLevel, isInside, type JsonNode, type JsonTreeModel } from './jsonModel';
import { searchJsonTree } from './jsonSearch';
import { rowIndexOf, treeRows } from './jsonRows';
import { jsonLines, visibleJsonLines } from './jsonTokenize';

export type JsonViewMode = 'tree' | 'json';
const MODE_KEY = 'abada.studio.jsonView';
const CHAR_WIDTH = 7.2;
const INDENT = 14;

function rememberedMode(): JsonViewMode {
  try { return localStorage.getItem(MODE_KEY) === 'json' ? 'json' : 'tree'; } catch { return 'tree'; }
}

const toggled = (set: ReadonlySet<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
};

const containersFrom = (tree: JsonTreeModel, level: number) =>
  new Set(tree.all.filter((node) => node.children && node.depth >= level).map((node) => node.path));

/**
 * The state behind one JsonViewer: the tree, the view mode, what is open or
 * folded, the search and its current match, the active row and the change
 * flash. Open containers are kept by path, so a refresh of the data keeps them.
 */
export function useJsonViewState(data: unknown, options: { defaultDepth: number; changed: ReadonlySet<string>; changeKey?: number }) {
  const tree = useMemo(() => buildJsonTree(data ?? {}), [data]);
  const [mode, setModeState] = useState<JsonViewMode>(rememberedMode);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [openStrings, setOpenStrings] = useState<ReadonlySet<string>>(new Set());
  const [initialised, setInitialised] = useState(false);
  const [active, setActive] = useState(0);
  const [hit, setHit] = useState(0);
  const [width, setWidth] = useState(600);
  const [flashing, setFlashing] = useState(false);
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  const [revealLine, setRevealLine] = useState(-1);

  // Open the first levels once, when the first data arrives (adjusted during render, no stale frame).
  if (!initialised && tree.roots.length > 0) {
    setInitialised(true);
    setExpanded(containersToLevel(tree, options.defaultDepth));
  }

  const setMode = useCallback((next: JsonViewMode) => {
    setModeState(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* a private window keeps no preference */ }
  }, []);

  const search = useMemo(() => searchJsonTree(tree, query), [tree, query]);
  const currentHit: JsonNode | null = search?.hits[Math.min(hit, search.hits.length - 1)] ?? null;
  const charsPerLine = useCallback((depth: number) => Math.floor((width - depth * INDENT - 48) / CHAR_WIDTH), [width]);
  const rows = useMemo(
    () => (mode === 'tree' ? treeRows(tree, { expanded, openStrings, search, charsPerLine }) : []),
    [mode, tree, expanded, openStrings, search, charsPerLine],
  );
  const allLines = useMemo(() => (mode === 'json' ? jsonLines(tree) : []), [mode, tree]);
  const lines = useMemo(() => visibleJsonLines(allLines, folded, search?.opened), [allLines, folded, search]);

  const changedInside = useMemo(() => {
    const inside = new Set<string>();
    for (const node of tree.all) if (node.children && [...options.changed].some((path) => isInside(path, node.path))) inside.add(node.path);
    return inside;
  }, [tree, options.changed]);

  // One flash per change set; the marker dot stays until the next one.
  useEffect(() => {
    if (options.changed.size === 0) return;
    setFlashing(true);
    const timer = window.setTimeout(() => setFlashing(false), 700);
    return () => window.clearTimeout(timer);
  }, [options.changed, options.changeKey]);

  // Follow the current search match.
  const hitRow = currentHit ? rowIndexOf(rows, currentHit) : -1;
  useEffect(() => { if (hitRow >= 0) setActive(hitRow); }, [hitRow]);
  const hitLine = currentHit ? lines.findIndex((line) => line.node === currentHit) : -1;

  // A revealed path (from the changed list) becomes the active row once its ancestors are open.
  useEffect(() => {
    if (!pendingReveal) return;
    const node = tree.byPath.get(pendingReveal);
    if (node) {
      const row = rowIndexOf(rows, node);
      if (row >= 0) setActive(row);
      setRevealLine(lines.findIndex((line) => line.node === node));
    }
    setPendingReveal(null);
  }, [pendingReveal, rows, lines, tree]);

  const clampedActive = Math.min(active, Math.max(0, rows.length - 1));
  return {
    tree, mode, setMode, query, rows, lines, search, currentHit, lineTarget: hitLine >= 0 ? hitLine : revealLine, flashing, changedInside,
    expanded, openStrings, active: clampedActive, setActive, setWidth,
    hitIndex: Math.min(hit, Math.max(0, (search?.hits.length ?? 1) - 1)),
    setQuery: (next: string) => { setQuery(next); setHit(0); setActive(0); },
    moveHit: (step: 1 | -1) => {
      const count = search?.hits.length ?? 0;
      if (count) setHit((current) => (Math.min(current, count - 1) + step + count) % count);
    },
    toggle: (node: JsonNode) => setExpanded((current) => toggled(current, node.path)),
    toggleString: (node: JsonNode) => setOpenStrings((current) => toggled(current, node.path)),
    fold: (path: string) => setFolded((current) => toggled(current, path)),
    expandSiblings: (node: JsonNode) => setExpanded((current) => {
      const next = new Set(current);
      (node.parent?.children ?? tree.roots).forEach((sibling) => { if (sibling.children) next.add(sibling.path); });
      return next;
    }),
    expandAll: () => { if (mode === 'tree') setExpanded(containersToLevel(tree, Infinity)); else setFolded(new Set()); },
    collapseAll: () => {
      if (mode === 'tree') { setExpanded(new Set()); setActive(0); } else setFolded(containersFrom(tree, 0));
    },
    expandTo: (level: number) => { setExpanded(containersToLevel(tree, level)); setFolded(containersFrom(tree, level)); },
    /** Opens the ancestors of `path` and makes it the active row. */
    revealPath: (path: string) => {
      const node = tree.byPath.get(path);
      if (!node) return;
      setExpanded((current) => { const next = new Set(current); for (let p = node.parent; p; p = p.parent) next.add(p.path); return next; });
      setFolded((current) => { const next = new Set(current); for (let p = node.parent; p; p = p.parent) next.delete(p.path); return next; });
      setQuery('');
      setPendingReveal(path);
    },
  };
}
