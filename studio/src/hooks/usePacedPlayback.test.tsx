import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import css from '../index.css?raw';
import { resetPlaybackPaceForTests } from '@/lib/run/playbackPace';
import type { PlaybackPace } from '@/lib/run/playbackPace';
import { stepEnds, usePacedPlayback, type PacedPlayback } from './usePacedPlayback';
import { trailPrefix } from './useInstancePlayback';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Fact { id: string; kind: 'flow' | 'note' | 'incident'; from?: string }

const id = (fact: Fact) => fact.id;
const isStep = (fact: Fact) => fact.kind === 'flow';
const sameStep = (previous: Fact, next: Fact) => !!previous.from && previous.from === next.from;
const isUrgent = (fact: Fact) => fact.kind === 'incident';

const flow = (n: number, from = `n${n}`): Fact => ({ id: `f${n}`, kind: 'flow', from });

let latest: PacedPlayback<Fact>;
const Probe: React.FC<{ facts: Fact[]; pace?: PlaybackPace; urgentKey?: string; resetKey?: string; fromStart?: boolean }> = (props) => {
  latest = usePacedPlayback(props.facts, { id, isStep, sameStep, isUrgent, ...props });
  return null;
};

let root: Root;
const show = (props: React.ComponentProps<typeof Probe>) => act(() => { root.render(<Probe {...props} />); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const visibleIds = () => latest.visible.map((fact) => fact.id);

beforeEach(() => {
  vi.useFakeTimers();
  resetPlaybackPaceForTests();
  window.localStorage.clear();
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('usePacedPlayback', () => {
  it('shows the state at opening at once, then facts arriving within 50 ms one per dwell, in order', () => {
    const opening = [flow(1), flow(2)];
    show({ facts: opening, pace: 'calm' });
    expect(visibleIds()).toEqual(['f1', 'f2']);
    expect(latest.lag).toBe(0);

    show({ facts: [...opening, flow(3)], pace: 'calm' });
    advance(20);
    show({ facts: [...opening, flow(3), flow(4)], pace: 'calm' });
    advance(30);
    show({ facts: [...opening, flow(3), flow(4), flow(5)], pace: 'calm' });
    // The first new step shows at once; the next two wait their turn.
    expect(visibleIds()).toEqual(['f1', 'f2', 'f3']);
    expect(latest.lag).toBe(2);

    advance(600);
    expect(visibleIds()).toEqual(['f1', 'f2', 'f3']);
    advance(100);
    expect(visibleIds()).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(latest.lag).toBe(1);
    advance(700);
    expect(visibleIds()).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
    expect(latest.lag).toBe(0);
  });

  it('brisk holds each step for 250 ms', () => {
    show({ facts: [flow(1)], pace: 'brisk' });
    show({ facts: [flow(1), flow(2), flow(3)], pace: 'brisk' });
    advance(0);
    expect(visibleIds()).toEqual(['f1', 'f2']);
    advance(250);
    expect(visibleIds()).toEqual(['f1', 'f2', 'f3']);
  });

  it('shows a fact delivered twice once', () => {
    show({ facts: [flow(1)], pace: 'calm' });
    show({ facts: [flow(1), flow(2), flow(2), flow(1), flow(3)], pace: 'calm' });
    advance(0);
    advance(700);
    expect(visibleIds()).toEqual(['f1', 'f2', 'f3']);
    expect(latest.lag).toBe(0);
  });

  it('never holds an incident back: the playback catches up to it', () => {
    show({ facts: [flow(1)], pace: 'calm' });
    show({ facts: [flow(1), flow(2), flow(3), flow(4)], pace: 'calm' });
    advance(0);
    expect(latest.lag).toBe(2);
    show({ facts: [flow(1), flow(2), flow(3), flow(4), { id: 'i1', kind: 'incident' }], pace: 'calm' });
    expect(visibleIds()).toEqual(['f1', 'f2', 'f3', 'f4', 'i1']);
    expect(latest.lag).toBe(0);
  });

  it('catches up when the real state turns urgent (terminal, incident)', () => {
    show({ facts: [flow(1)], pace: 'calm' });
    show({ facts: [flow(1), flow(2), flow(3), flow(4)], pace: 'calm' });
    advance(0);
    expect(latest.lag).toBe(2);
    show({ facts: [flow(1), flow(2), flow(3), flow(4)], pace: 'calm', urgentKey: 'COMPLETED' });
    expect(latest.lag).toBe(0);
    expect(visibleIds()).toHaveLength(4);
  });

  it('instant reproduces the current behaviour: every fact as it arrives', () => {
    show({ facts: [flow(1)], pace: 'instant' });
    show({ facts: [flow(1), flow(2), flow(3)], pace: 'instant' });
    expect(visibleIds()).toEqual(['f1', 'f2', 'f3']);
    expect(latest.lag).toBe(0);
  });

  it('jump to now flushes the queue', () => {
    show({ facts: [flow(1)], pace: 'calm' });
    show({ facts: [flow(1), flow(2), flow(3), flow(4)], pace: 'calm' });
    advance(0);
    expect(latest.lag).toBe(2);
    act(() => latest.jumpToNow());
    expect(latest.lag).toBe(0);
    expect(visibleIds()).toHaveLength(4);
  });

  it('advances the branches of a parallel split together, with the facts before them', () => {
    const facts: Fact[] = [flow(1)];
    show({ facts, pace: 'calm' });
    const split: Fact[] = [...facts, { id: 'task-done', kind: 'note' }, flow(2, 'fork'), flow(3, 'fork'),
      flow(4), { id: 'task-created', kind: 'note' }];
    show({ facts: split, pace: 'calm' });
    advance(0);
    expect(visibleIds()).toEqual(['f1', 'task-done', 'f2', 'f3']);
    advance(700);
    // The last step brings the facts after it along.
    expect(visibleIds()).toEqual(['f1', 'task-done', 'f2', 'f3', 'f4', 'task-created']);
  });

  it('starts over at the current state for another instance', () => {
    show({ facts: [flow(1)], pace: 'calm', resetKey: 'a' });
    show({ facts: [flow(1), flow(2), flow(3), flow(4)], pace: 'calm', resetKey: 'a' });
    advance(0);
    expect(latest.lag).toBe(2);
    show({ facts: [flow(7), flow(8)], pace: 'calm', resetKey: 'b' });
    expect(visibleIds()).toEqual(['f7', 'f8']);
    expect(latest.lag).toBe(0);
  });

  it('uses the stored pace preference, default calm', () => {
    show({ facts: [] });
    expect(latest.pace).toBe('calm');
    act(() => latest.setPace('brisk'));
    expect(latest.pace).toBe('brisk');
    expect(window.localStorage.getItem('abada.playbackPace')).toBe('brisk');
  });

  it('keeps the order under reduced motion: pacing is not movement', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('matchMedia', matchMedia);
    show({ facts: [flow(1)], pace: 'calm' });
    show({ facts: [flow(1), flow(2), flow(3)], pace: 'calm' });
    advance(0);
    expect(visibleIds()).toEqual(['f1', 'f2']);
    advance(700);
    expect(visibleIds()).toEqual(['f1', 'f2', 'f3']);
    vi.unstubAllGlobals();
    // The arrival animations drop their transforms and keep a fade.
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('abada-arrive')));
    const block = reduced.slice(0, reduced.indexOf('\n}\n'));
    expect(block).toContain('.abada-arrive-node');
    expect(block).toContain('.abada-arrive-edge');
    expect(block).not.toMatch(/scale|translate/);
  });
});

describe('stepEnds', () => {
  it('ends each step after its step fact, grouping consecutive steps of one split', () => {
    expect(stepEnds([flow(1), { id: 'x', kind: 'note' }, flow(2, 'g'), flow(3, 'g'), flow(4)], isStep, sameStep))
      .toEqual([1, 4, 5]);
  });
});

describe('usePacedPlayback holding a retry (M5 S4)', () => {
  interface Held { id: string; kind: 'flow' | 'retry' | 'incident' }
  let held: PacedPlayback<Held>;
  const HeldProbe: React.FC<{ facts: Held[]; urgentKey?: string }> = ({ facts, urgentKey }) => {
    held = usePacedPlayback(facts, {
      id: (fact) => fact.id,
      isStep: (fact) => fact.kind !== 'incident',
      isUrgent: (fact) => fact.kind === 'incident',
      holdsCatchUp: (fact) => fact.kind === 'retry',
      urgentKey,
      pace: 'calm',
    });
    return null;
  };
  const showHeld = (facts: Held[], urgentKey?: string) => act(() => { root.render(<HeldProbe facts={facts} urgentKey={urgentKey} />); });
  const heldIds = () => held.visible.map((fact) => fact.id);

  it('plays a retry one phase per dwell even when the instance ends in the same refetch, then catches up', () => {
    const opening: Held[] = [{ id: 'f1', kind: 'flow' }];
    showHeld(opening);
    const retry: Held[] = [
      { id: 'retried', kind: 'retry' }, { id: 'locked', kind: 'retry' }, { id: 'completed', kind: 'retry' },
      { id: 'f2', kind: 'flow' }, { id: 'f3', kind: 'flow' },
    ];
    // The engine finished the retry and the instance in milliseconds: one refetch brings it all, terminal included.
    showHeld([...opening, ...retry], 'COMPLETED|');
    advance(0);
    expect(heldIds()).toEqual(['f1', 'retried']);
    advance(700);
    expect(heldIds()).toEqual(['f1', 'retried', 'locked']);
    advance(700);
    // The last held fact is shown: the terminal state is now caught up at once.
    expect(heldIds()).toEqual(['f1', 'retried', 'locked', 'completed', 'f2', 'f3']);
    expect(held.lag).toBe(0);
  });

  it('a failure after the retry is shown in turn, and Jump to now still flushes', () => {
    showHeld([{ id: 'f1', kind: 'flow' }]);
    showHeld([{ id: 'f1', kind: 'flow' }, { id: 'retried', kind: 'retry' }, { id: 'locked', kind: 'retry' },
      { id: 'failed', kind: 'retry' }, { id: 'incident', kind: 'incident' }], '|charge');
    advance(0);
    expect(heldIds()).toEqual(['f1', 'retried']);
    act(() => held.jumpToNow());
    expect(heldIds()).toEqual(['f1', 'retried', 'locked', 'failed', 'incident']);
  });
});

describe('an instance the user just started (M5 S5)', () => {
  const note = (n: number): Fact => ({ id: `n${n}`, kind: 'note' });

  it('plays the facts present at opening from the first one, one step per dwell', () => {
    show({ facts: [note(0), flow(1), flow(2), flow(3)], pace: 'calm', fromStart: true });
    advance(0);
    expect(visibleIds()).toEqual(['n0', 'f1']);
    expect(latest.lag).toBe(2);
    advance(700);
    expect(visibleIds()).toEqual(['n0', 'f1', 'f2']);
    advance(700);
    expect(visibleIds()).toEqual(['n0', 'f1', 'f2', 'f3']);
  });

  it('still catches up to an urgent fact at once', () => {
    show({ facts: [flow(1), flow(2), { id: 'boom', kind: 'incident' }], pace: 'calm', fromStart: true });
    expect(visibleIds()).toEqual(['f1', 'f2', 'boom']);
  });

  it('shows everything at once at the instant pace', () => {
    show({ facts: [flow(1), flow(2)], pace: 'instant', fromStart: true });
    expect(visibleIds()).toEqual(['f1', 'f2']);
  });
});

describe('the audit trail prefix', () => {
  const note = (n: number): Fact => ({ id: `n${n}`, kind: 'note' });
  const facts = [note(0), flow(1), note(1), note(2), flow(2), note(3)];

  it('adds the facts recorded after the last visible step, up to the next step', () => {
    expect(trailPrefix(facts, 0, isStep).map(id)).toEqual(['n0']);
    expect(trailPrefix(facts, 2, isStep).map(id)).toEqual(['n0', 'f1', 'n1', 'n2']);
    expect(trailPrefix(facts, 5, isStep).map(id)).toEqual(['n0', 'f1', 'n1', 'n2', 'f2', 'n3']);
  });
});
