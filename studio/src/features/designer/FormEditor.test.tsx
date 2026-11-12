import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FormEditor } from './FormEditor';
import { FormSchema } from '@/features/inbox/formSchema';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const schema: FormSchema = {
  title: 'Approval',
  fields: [
    { id: 'name', type: 'string', label: 'Name', required: true },
    { id: 'amount', type: 'number', label: 'Amount' },
  ],
};

function open(onSave = vi.fn(), onClose = vi.fn()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<FormEditor initialSchema={schema} onSave={onSave} onClose={onClose} location="forms/approval.json" />); });
  return { onSave, onClose, unmount: () => act(() => root.unmount()) };
}

const button = (label: string) => Array.from(document.body.querySelectorAll('button'))
  .find((candidate) => candidate.textContent?.trim().startsWith(label) || candidate.getAttribute('aria-label') === label) as HTMLButtonElement;
const key = (target: EventTarget, init: KeyboardEventInit) => act(() => {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
});

describe('FormEditor', () => {
  it('opens as a modal panel with palette, canvas and properties', () => {
    const { unmount } = open();
    const dialog = document.body.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Form designer');
    expect(document.body.querySelector('[aria-label="Field palette"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Properties"]')?.textContent).toContain('Name');
    expect(document.body.textContent).toContain('forms/approval.json');
    unmount();
  });

  it('adds a field from the palette, and undo takes it back', () => {
    const { unmount } = open();
    act(() => { button('◷Date & time').click(); });
    expect(document.body.querySelector('[data-form-cell="datetime"]')).not.toBeNull();
    key(document.body, { key: 'z', metaKey: true });
    expect(document.body.querySelector('[data-form-cell="datetime"]')).toBeNull();
    key(document.body, { key: 'z', metaKey: true, shiftKey: true });
    expect(document.body.querySelector('[data-form-cell="datetime"]')).not.toBeNull();
    unmount();
  });

  it('changes a field width with the arrow keys', () => {
    const { unmount } = open();
    const cell = document.body.querySelector('[data-form-cell="amount"]') as HTMLElement;
    act(() => { cell.click(); });
    expect(cell.getAttribute('aria-label')).toContain('width 1 of 4');
    key(cell, { key: 'ArrowRight' });
    expect((document.body.querySelector('[data-form-cell="amount"]') as HTMLElement).getAttribute('aria-label')).toContain('width 2 of 4');
    unmount();
  });

  it('closes on Esc when nothing changed', () => {
    const { onClose, unmount } = open();
    key(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('guards unsaved changes on Esc: keep editing, or discard', () => {
    const { onClose, unmount } = open();
    act(() => { button('◉Radio').click(); });
    key(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Unsaved changes.');
    act(() => { button('Keep editing').click(); });
    expect(document.body.textContent).not.toContain('Close without saving them?');
    key(document.body, { key: 'Escape' });
    act(() => { button('Discard changes').click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('saves the laid-out schema with a file field', () => {
    const { onSave, unmount } = open();
    act(() => { button('⇪File').click(); });
    expect(document.body.querySelector('[data-form-cell="file"]')).not.toBeNull();
    act(() => { button('Save form').click(); });
    const saved = onSave.mock.calls[0][0] as FormSchema;
    expect(saved.fields.map((field) => field.id)).toEqual(['name', 'amount', 'file']);
    expect(saved.fields[2].type).toBe('file');
    expect(saved.layout?.sections).toHaveLength(1);
    unmount();
  });

  it('previews the real form at phone width', () => {
    const { unmount } = open();
    act(() => { button('Preview').click(); });
    act(() => { button('Mobile').click(); });
    const preview = document.body.querySelector('[data-density]') as HTMLElement;
    expect(preview.dataset.layout).toBe('mobile');
    expect(document.body.querySelector('#field-name')).not.toBeNull();
    unmount();
  });
});
