import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type } from '@/test/render';
import { JsonViewer } from './JsonViewer';
import { REDACTION_MASK } from './jsonModel';

const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)!;
const rowOf = (container: HTMLElement, path: string) =>
  [...container.querySelectorAll('[role="treeitem"]')].find((row) => row.textContent?.includes(path));
const key = (element: Element, value: string) =>
  act(() => { element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })); });

/** 500 variables, each nested six levels deep. */
function manyVariables() {
  const nest = (depth: number, index: number): unknown =>
    depth === 6 ? `leaf ${index}` : {
      [`level${depth}`]: nest(depth + 1, index),
      [`n${depth}`]: depth * index,
      ...(depth < 5 ? { items: [depth, index] } : {}),
    };
  return Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`var_${String(index).padStart(3, '0')}`, nest(1, index)]));
}

const sample = {
  applicant: { name: 'Dana Weber', address: { city: 'Hamburg', postcode: '20457' } },
  items: [{ sku: 'A-1' }, { sku: 'B-2' }],
  email: REDACTION_MASK,
  note: `Call ${REDACTION_MASK} after lunch`,
  essay: 'x'.repeat(300),
  upload: { fileId: 'f1', name: 'quote.pdf', contentType: 'application/pdf', size: 2048 },
  approved: true,
  score: 82,
  missing: null,
};

describe('JsonViewer', () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('opens the parents of a deep match and highlights it', () => {
    const container = render(<JsonViewer data={manyVariables()} label="variables" defaultDepth={0} />);
    type(container.querySelector('input[type="search"]')!, 'leaf 417');
    const marks = [...container.querySelectorAll('mark')].map((mark) => mark.textContent);
    expect(marks).toContain('leaf 417');
    // var_417 → level1 → … → level4 hold the leaf at the sixth level.
    const open = [...container.querySelectorAll('[role="treeitem"][aria-expanded]')];
    expect(open.length).toBe(5);
    expect(container.querySelector('[role="treeitem"][aria-level="6"]')?.textContent).toContain('leaf 417');
    expect(open.every((row) => row.getAttribute('aria-expanded') === 'true')).toBe(true);
    expect(container.textContent).toContain('1 of 1');
  });

  it('copies the exact path and the value', () => {
    const container = render(<JsonViewer data={sample} label="variables" defaultDepth={3} />);
    const city = rowOf(container, 'city')!;
    click(button(city as HTMLElement, 'Copy path'));
    expect(writeText).toHaveBeenLastCalledWith('applicant.address.city');
    click(button(city as HTMLElement, 'Copy value'));
    expect(writeText).toHaveBeenLastCalledWith('Hamburg');
    click(button(rowOf(container, 'sku')! as HTMLElement, 'Copy path'));
    expect(writeText).toHaveBeenLastCalledWith('items[0].sku');
  });

  it('never puts a masked value in the DOM, in either view', () => {
    const container = render(<JsonViewer data={sample} label="variables" />);
    expect(container.innerHTML).not.toContain(REDACTION_MASK);
    expect(container.querySelectorAll('[title="Masked by the project\'s evidence policy"]').length).toBe(2);
    expect((button(rowOf(container, 'email')! as HTMLElement, 'Copy value') as HTMLButtonElement).disabled).toBe(true);
    click(button(container, 'JSON'));
    expect(container.innerHTML).not.toContain(REDACTION_MASK);
    expect(container.textContent).toContain('redacted');
  });

  it('cuts long strings with show more, and shows file references as chips', () => {
    const container = render(<JsonViewer data={sample} label="variables" />);
    expect(container.textContent).toContain('show more · 300 chars');
    click(button(container, 'show more · 300 chars'));
    expect(container.textContent).toContain('show less');
    expect(container.textContent).toContain('quote.pdf');
    expect(container.textContent).toContain('2 kB');
  });

  it('moves through the tree with the keyboard', () => {
    const container = render(<JsonViewer data={sample} label="variables" defaultDepth={0} />);
    const tree = container.querySelector('[role="tree"]')!;
    const active = () => container.querySelector('[role="treeitem"][aria-selected="true"]')!;
    expect(active().textContent).toContain('applicant');
    key(tree, 'ArrowRight');
    expect(active().getAttribute('aria-expanded')).toBe('true');
    key(tree, 'ArrowRight');
    expect(active().textContent).toContain('name');
    expect(active().getAttribute('aria-level')).toBe('2');
    key(tree, 'ArrowLeft');
    expect(active().textContent).toContain('applicant');
    key(tree, 'ArrowLeft');
    expect(active().getAttribute('aria-expanded')).toBe('false');
    key(tree, 'End');
    expect(active().textContent).toContain('missing');
    key(tree, 'p');
    expect(writeText).toHaveBeenLastCalledWith('missing');
    expect(tree.getAttribute('aria-activedescendant')).toBe(active().id);
  });

  it('shows numbered JSON lines that fold', () => {
    const container = render(<JsonViewer data={{ a: { b: 1 }, c: [1, 2] }} label="variables" />);
    click(button(container, 'JSON'));
    expect([...container.querySelectorAll('[data-line]')].map((line) => line.getAttribute('data-line'))).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    click(container.querySelector('[aria-label="Fold a"]')!);
    expect(container.querySelectorAll('[data-line]').length).toBe(7);
    expect(container.textContent).toContain('{…} 1 keys');
    expect(localStorage.getItem('abada.studio.jsonView')).toBe('json');
  });

  it('flashes the changed paths once and keeps a marker', () => {
    vi.useFakeTimers();
    try {
      const container = render(<JsonViewer data={sample} label="variables" changedPaths={new Set(['score'])} />);
      expect(rowOf(container, 'score')!.className).toContain('abada-json-flash');
      expect(container.textContent).toContain('Changed in the last update:');
      act(() => { vi.advanceTimersByTime(800); });
      expect(rowOf(container, 'score')!.className).not.toContain('abada-json-flash');
      expect(rowOf(container, 'score')!.textContent).toContain('changed in the last update');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the loading and empty states', () => {
    expect(render(<JsonViewer data={null} loading label="variables" />).querySelector('[aria-label="Reading variables"]')).not.toBeNull();
    expect(render(<JsonViewer data={{}} label="variables" />).textContent).toContain('No variables yet.');
  });
});
