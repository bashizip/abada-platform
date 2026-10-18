import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click, render } from '@/test/render';
import { JsonViewer } from './JsonViewer';

/**
 * The S11 render budget: 500 variables six levels deep, all expanded, in
 * under 100 ms. Timing tests need the CPU to themselves, so vitest.config.ts
 * runs this file alone, after every other test file (the `perf` project).
 */
const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)!;

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

describe('JsonViewer render budget', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('renders 500 variables six levels deep, all expanded, in under 100 ms with a bounded DOM', () => {
    const data = manyVariables();
    const container = render(<JsonViewer data={data} label="variables" defaultDepth={0} />);
    // The fastest of three renders, so one scheduling hiccup does not decide the result.
    const timings: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) click(button(container, 'Collapse all'));
      const started = performance.now();
      click(button(container, 'Expand all'));
      timings.push(performance.now() - started);
    }
    const elapsed = Math.min(...timings);
    expect(container.querySelectorAll('[role="treeitem"]').length).toBeLessThanOrEqual(80);
    expect(container.textContent).toContain('500 variables');
    expect(container.textContent).toContain('6 levels');
    expect(elapsed).toBeLessThan(100);
  });
});
