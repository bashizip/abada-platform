import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUS_CARD_OFFSET, FOCUS_SETTLE_MS, useFocusNode, type FocusViewport } from './useFocusNode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let onUserMove: () => void;
const viewport = {
  getNode: vi.fn(() => ({ position: { x: 100, y: 40 }, measured: { width: 200, height: 80 } })),
  getZoom: vi.fn(() => 0.5),
  setCenter: vi.fn(),
} satisfies FocusViewport;

const Probe: React.FC<{ focusKey?: string; direction?: 'horizontal' | 'vertical'; reduced?: boolean }> = ({
  focusKey, direction = 'horizontal', reduced = false,
}) => {
  onUserMove = useFocusNode(focusKey ? { nodeId: 'charge', key: focusKey } : null,
    { ready: true, direction, reducedMotion: reduced, viewport });
  return null;
};

let root: Root;
const show = (props: React.ComponentProps<typeof Probe>) => act(() => { root.render(<Probe {...props} />); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('focusing a node on the canvas', () => {
  it('pans to a new incident, zooming in to a readable size, below centre for its card', () => {
    show({ focusKey: 'a' });
    advance(FOCUS_SETTLE_MS);
    expect(viewport.setCenter).toHaveBeenCalledWith(200, 80 + FOCUS_CARD_OFFSET, { zoom: 0.9, duration: 240 });
    show({ focusKey: 'a' });
    advance(FOCUS_SETTLE_MS);
    expect(viewport.setCenter).toHaveBeenCalledTimes(1);
  });

  it('leaves the canvas where the user just put it', () => {
    show({});
    onUserMove();
    show({ focusKey: 'b' });
    advance(FOCUS_SETTLE_MS);
    expect(viewport.setCenter).not.toHaveBeenCalled();
    advance(5000);
    show({ focusKey: 'c' });
    advance(FOCUS_SETTLE_MS);
    expect(viewport.setCenter).toHaveBeenCalledTimes(1);
  });

  it('jumps without movement under reduced motion, beside the node in vertical flows', () => {
    show({ focusKey: 'd', direction: 'vertical', reduced: true });
    advance(FOCUS_SETTLE_MS);
    expect(viewport.setCenter).toHaveBeenCalledWith(200 + FOCUS_CARD_OFFSET, 80, { zoom: 0.9, duration: 0 });
  });
});
