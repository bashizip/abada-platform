import type { WorkflowFile } from '@/types';

/**
 * Undo/redo history for one process document. It records the document's
 * content before each edit; persistence metadata (ids, revision, folder,
 * file name, process key) and view state are left alone, so undoing never
 * fights autosave or the immutable process key.
 */
export type WorkflowContent = Omit<WorkflowFile,
  'id' | 'documentId' | 'revision' | 'updatedAt' | 'folderId' | 'fileName' | 'processKey' | 'layoutPending'>;

export interface WorkflowHistory {
  past: WorkflowContent[];
  future: WorkflowContent[];
  /** Kind and time of the last recorded edit, for coalescing. */
  lastKind?: string;
  lastAt?: number;
}

/** Most undo steps kept per document. */
export const HISTORY_LIMIT = 100;
/** Edits of the same kind closer together than this merge into one undo step (drag, typing). */
export const COALESCE_MS = 600;

export const emptyHistory = (): WorkflowHistory => ({ past: [], future: [] });

export const contentOf = (workflow: WorkflowFile): WorkflowContent => {
  const {
    id: _id, documentId: _documentId, revision: _revision, updatedAt: _updatedAt,
    folderId: _folderId, fileName: _fileName, processKey: _processKey, layoutPending: _layoutPending,
    ...content
  } = workflow;
  return content;
};

/** Applies recorded content onto the current workflow, keeping its persistence metadata. */
export const withContent = (workflow: WorkflowFile, content: WorkflowContent): WorkflowFile => ({
  ...workflow,
  ...content,
});

const sameContent = (a: WorkflowContent, b: WorkflowContent): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Records `before` as an undo step for an edit that turns it into `after`.
 * A no-op edit records nothing; an edit of the same `kind` within
 * {@link COALESCE_MS} of the previous one extends that step instead of adding
 * one. Any new edit clears the redo stack.
 */
export function record(history: WorkflowHistory, before: WorkflowFile, after: WorkflowFile,
  kind: string, now: number): WorkflowHistory {
  const previous = contentOf(before);
  if (sameContent(previous, contentOf(after))) return history;
  const coalesce = history.past.length > 0 && history.lastKind === kind
    && history.lastAt !== undefined && now - history.lastAt < COALESCE_MS;
  const past = coalesce ? history.past : [...history.past, previous].slice(-HISTORY_LIMIT);
  return { past, future: [], lastKind: kind, lastAt: now };
}

/** Steps back: returns the content to restore, or null when there is nothing to undo. */
export function undo(history: WorkflowHistory, current: WorkflowFile):
  { history: WorkflowHistory; content: WorkflowContent } | null {
  if (history.past.length === 0) return null;
  const content = history.past[history.past.length - 1];
  return {
    content,
    history: { past: history.past.slice(0, -1), future: [contentOf(current), ...history.future] },
  };
}

/** Steps forward again after an undo. */
export function redo(history: WorkflowHistory, current: WorkflowFile):
  { history: WorkflowHistory; content: WorkflowContent } | null {
  if (history.future.length === 0) return null;
  const [content, ...rest] = history.future;
  return {
    content,
    history: { past: [...history.past, contentOf(current)].slice(-HISTORY_LIMIT), future: rest },
  };
}
