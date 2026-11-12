import React from 'react';
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ActivityHistoryDTO } from '@/api/engine';
import { diffVariables, namedVariables } from '@/lib/run/variableChanges';
import { useVariableChanges, type VariableChanges } from './useVariableChanges';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fact = (id: string, eventType: string, details: Record<string, unknown> = {}) =>
  ({ id, eventType, details, occurredAt: '2026-10-18T09:00:00Z' }) as unknown as ActivityHistoryDTO;

describe('diffVariables', () => {
  it('reports added, removed and changed paths, nested, once per whole value', () => {
    const before = { a: 1, lead: { score: 3, tags: ['x'] }, gone: { deep: true } };
    const after = { a: 1, lead: { score: 4, tags: ['x', 'y'] }, added: { x: { y: 1 } } };
    expect(diffVariables(before, after).sort()).toEqual(['added', 'gone', 'lead.score', 'lead.tags[1]']);
    expect(diffVariables(before, before)).toEqual([]);
  });

  it('reads the names a fact records', () => {
    expect(namedVariables(fact('1', 'VARIABLES_UPDATED', { variableNames: ['amount', 'x-ref'] }))).toEqual(['amount', '["x-ref"]']);
    expect(namedVariables(fact('2', 'DECISION_TABLE_APPLIED', { outputNames: ['route'] }))).toEqual(['route']);
    expect(namedVariables(fact('3', 'TASK_COMPLETED', { outcome: 'approve' }))).toEqual([]);
  });
});

describe('useVariableChanges', () => {
  function mount() {
    let latest: VariableChanges = { changed: new Set(), key: 0, held: false };
    const Probe: React.FC<{ variables: Record<string, unknown> | null; facts?: ActivityHistoryDTO[]; lag?: number; reset?: string }> = (props) => {
      latest = useVariableChanges(props.variables, { visibleFacts: props.facts, lag: props.lag, resetKey: props.reset });
      return null;
    };
    const container = document.createElement('div');
    const root = createRoot(container);
    return {
      render: (props: React.ComponentProps<typeof Probe>) => act(() => { root.render(<Probe {...props} />); }),
      get value() { return latest; },
    };
  }

  it('shows nothing on the first read, then what the next read changed', () => {
    const probe = mount();
    probe.render({ variables: { a: 1, b: 1 } });
    expect([...probe.value.changed]).toEqual([]);
    probe.render({ variables: { a: 2, b: 1 } });
    expect([...probe.value.changed]).toEqual(['a']);
    expect(probe.value.key).toBe(1);
  });

  it('holds the changes while the playback lags and shows them when it catches up', () => {
    const probe = mount();
    probe.render({ variables: { a: 1 }, lag: 0 });
    probe.render({ variables: { a: 2 }, lag: 3 });
    expect([...probe.value.changed]).toEqual([]);
    expect(probe.value.held).toBe(true);
    probe.render({ variables: { a: 2, b: 1 }, lag: 1 });
    expect([...probe.value.changed]).toEqual([]);
    probe.render({ variables: { a: 2, b: 1 }, lag: 0 });
    expect([...probe.value.changed].sort()).toEqual(['a', 'b']);
    expect(probe.value.held).toBe(false);
  });

  it('shows the names a fact records as the fact becomes visible, not the ones already on screen', () => {
    const probe = mount();
    const old = fact('1', 'VARIABLES_UPDATED', { variableNames: ['old'] });
    probe.render({ variables: { a: 1 }, facts: [old], lag: 2 });
    expect([...probe.value.changed]).toEqual([]);
    probe.render({ variables: { a: 1 }, facts: [old, fact('2', 'VARIABLES_UPDATED', { variableNames: ['amount'] })], lag: 1 });
    expect([...probe.value.changed]).toEqual(['amount']);
  });

  it('starts over for another instance', () => {
    const probe = mount();
    probe.render({ variables: { a: 1 }, reset: 'one' });
    probe.render({ variables: { a: 9, z: 1 }, reset: 'two' });
    expect([...probe.value.changed]).toEqual([]);
  });
});
