import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimatedNumber, Drawer, EmptyState, Skeleton, StatusPill } from './ui';
import { createRoot, type Root } from 'react-dom/client';
import { byLabel, click } from '@/test/render';

const roots = new WeakMap<Element, Root>();

/** Renders into a fresh container and keeps its root so a test can re-render with new props. */
function render(element: React.ReactElement): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.set(container, root);
  act(() => { root.render(element); });
  return container;
}

const rootOf = (container: Element) => roots.get(container)!;

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('UI primitives', () => {
  it('Skeleton announces loading and renders one block per line', () => {
    const container = render(<Skeleton lines={3} label="Loading instances" />);
    const status = byLabel(container, 'Loading instances');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.children).toHaveLength(3);
  });

  it('EmptyState says what is missing and offers the next step', () => {
    const container = render(<EmptyState title="No instances yet" description="Start one from the designer."
      action={<button type="button">Open designer</button>} />);
    expect(container.textContent).toContain('No instances yet');
    expect(container.textContent).toContain('Start one from the designer.');
    expect(container.querySelector('button')?.textContent).toBe('Open designer');
  });

  it('StatusPill shows its state, marks what is live and follows a state change', () => {
    const container = render(<StatusPill tone="running" label="Running" live />);
    const pill = () => container.querySelector('[data-tone]')!;
    expect(pill().getAttribute('data-tone')).toBe('running');
    expect(pill().textContent).toBe('Running');
    expect(pill().querySelector('.abada-live-outline')).not.toBeNull();

    const root = rootOf(container);
    act(() => { root.render(<StatusPill tone="success" label="Completed" />); });
    expect(pill().getAttribute('data-tone')).toBe('success');
    expect(pill().textContent).toBe('Completed');
    expect(pill().querySelector('.abada-live-outline')).toBeNull();
  });

  it('Drawer opens with focus on Close and closes on Escape and on Close', () => {
    const onClose = vi.fn();
    const container = render(<Drawer open onClose={onClose} title="Incident"><p>details</p></Drawer>);
    const dialog = byLabel(container, 'Incident');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.textContent).toContain('details');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    click(byLabel(container, 'Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Drawer renders nothing while closed', () => {
    const container = render(<Drawer open={false} onClose={() => undefined} title="Incident">details</Drawer>);
    expect(container.textContent).toBe('');
  });

  it('AnimatedNumber shows the first value at once and counts to a new one', () => {
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const flush = (at: number) => act(() => { now = at; frames.splice(0).forEach((frame) => frame(at)); });

    const container = render(<AnimatedNumber value={100} />);
    expect(container.textContent).toBe('100');

    act(() => { rootOf(container).render(<AnimatedNumber value={200} />); });
    flush(120);
    const midway = Number(container.textContent);
    expect(midway).toBeGreaterThan(100);
    expect(midway).toBeLessThan(200);
    flush(240);
    expect(container.textContent).toBe('200');
    expect(frames).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
