import { describe, expect, it } from 'vitest';
import { isEditableTarget, undoShortcut } from './shortcuts';

const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe('undo shortcuts', () => {
  it('maps Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z and Ctrl+Y', () => {
    expect(undoShortcut(key('z', { metaKey: true }))).toBe('undo');
    expect(undoShortcut(key('z', { ctrlKey: true }))).toBe('undo');
    expect(undoShortcut(key('Z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(undoShortcut(key('y', { ctrlKey: true }))).toBe('redo');
  });

  it('ignores plain keys, Alt combinations and Cmd+Y', () => {
    expect(undoShortcut(key('z'))).toBeNull();
    expect(undoShortcut(key('z', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(undoShortcut(key('y', { metaKey: true }))).toBeNull();
    expect(undoShortcut(key('s', { metaKey: true }))).toBeNull();
  });

  it('leaves text fields to their native undo', () => {
    const input = document.createElement('input');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
