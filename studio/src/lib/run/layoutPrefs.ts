import { WorkflowNode } from '@/types';

const STORAGE_KEY = 'abada_preferred_layouts';

/**
 * Saved layout: the node positions that were locked by the user.
 * Keyed by processKey in the parent map.
 */
interface SavedLayout {
  nodes: Array<{ id: string; x: number; y: number }>;
  savedAt: string;
}

type LayoutStore = Record<string, SavedLayout>;

function readStore(): LayoutStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStore(store: LayoutStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/**
 * Save the current node positions as the preferred layout for a process.
 */
export function savePreferredLayout(processKey: string, nodes: WorkflowNode[]): void {
  const store = readStore();
  store[processKey] = {
    nodes: nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
    savedAt: new Date().toISOString(),
  };
  writeStore(store);
}

/**
 * Apply the saved layout to a set of nodes, matching by id.
 * Returns the nodes with updated positions, or the original nodes if no
 * saved layout exists.
 */
export function applyPreferredLayout(
  processKey: string,
  nodes: WorkflowNode[],
): WorkflowNode[] {
  const store = readStore();
  const saved = store[processKey];
  if (!saved) return nodes;

  const posMap = new Map(saved.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  return nodes.map((node) => {
    const pos = posMap.get(node.id);
    if (pos) {
      return { ...node, x: pos.x, y: pos.y };
    }
    return node;
  });
}

/**
 * Check if a saved layout exists for a process.
 */
export function hasSavedLayout(processKey: string): boolean {
  const store = readStore();
  return !!store[processKey];
}

/**
 * Get the timestamp when the layout was last saved, or null.
 */
export function getSavedLayoutTime(processKey: string): string | null {
  const store = readStore();
  return store[processKey]?.savedAt ?? null;
}
