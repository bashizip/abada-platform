/** Keyboard shortcuts for process-level undo/redo. */
export type HistoryShortcut = 'undo' | 'redo';

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>;

/**
 * Cmd/Ctrl+Z undoes; Shift+Cmd/Ctrl+Z and Ctrl+Y redo. Alt combinations are
 * left to the browser and the operating system.
 */
export function undoShortcut(event: KeyLike): HistoryShortcut | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) return 'redo';
  return null;
}

/** Text fields keep their native undo, so the document shortcut must not fire there. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const element = target as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((element as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image'].includes(type);
  }
  return element.isContentEditable === true;
}
