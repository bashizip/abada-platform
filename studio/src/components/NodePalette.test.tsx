import React, { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NodePalette } from './NodePalette';
import { NODE_KINDS, NODE_KIND_MIME, createNode, kindOf } from '@/features/designer/nodes/nodeCatalog';
import { shapeOf } from '@/lib/layout/nodeGeometry';
import { byLabel, click, render, type } from '@/test/render';

const entries = (container: Element) => [...container.querySelectorAll<HTMLButtonElement>('[data-kind]')];

describe('node palette', () => {
  it('offers every kind, drawn in the shape the canvas gives it', () => {
    const container = render(<NodePalette onAddNode={vi.fn()} />);
    const shown = entries(container);
    expect(shown.map((entry) => entry.dataset.kind)).toEqual(NODE_KINDS.map((spec) => spec.kind));
    for (const entry of shown) {
      const spec = NODE_KINDS.find((candidate) => candidate.kind === entry.dataset.kind)!;
      const glyph = entry.querySelector('[data-shape]') as HTMLElement;
      expect(glyph.dataset.shape, spec.kind).toBe(shapeOf({ type: spec.type }));
    }
  });

  it('includes call process and for each', () => {
    const container = render(<NodePalette onAddNode={vi.fn()} />);
    expect(container.textContent).toContain('Call process');
    expect(container.textContent).toContain('For each');
  });

  it('adds a node on click', () => {
    const onAddNode = vi.fn();
    const container = render(<NodePalette onAddNode={onAddNode} />);
    click(container.querySelector('[data-kind="decision-table"]')!);
    expect(onAddNode).toHaveBeenCalledWith('decision-table');
  });

  it('filters by name, description, APL type and keywords; Enter adds the first match', () => {
    const onAddNode = vi.fn();
    const container = render(<NodePalette onAddNode={onAddNode} />);
    const search = byLabel<HTMLInputElement>(container, 'Find a node');
    type(search, 'dmn');
    expect(entries(container).map((entry) => entry.dataset.kind)).toEqual(['decision-table']);
    type(search, 'webhook');
    expect(entries(container).map((entry) => entry.dataset.kind)).toEqual(['start']);
    act(() => { search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onAddNode).toHaveBeenCalledWith('start');
    type(search, 'nothing like this');
    expect(container.textContent).toContain('No node matches');
  });

  it('carries the kind when dragged', () => {
    const container = render(<NodePalette onAddNode={vi.fn()} />);
    const data = new Map<string, string>();
    const event = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', {
      value: { setData: (key: string, value: string) => data.set(key, value), effectAllowed: '' },
    });
    act(() => { container.querySelector('[data-kind="for-each"]')!.dispatchEvent(event); });
    expect(data.get(NODE_KIND_MIME)).toBe('for-each');
  });
});

describe('node catalog', () => {
  it('creates nodes that read back as their own kind', () => {
    for (const spec of NODE_KINDS) {
      const node = createNode(spec.kind, 'n1', { x: 0, y: 0 });
      expect(kindOf(node), spec.kind).toBe(spec.kind);
    }
  });
});
