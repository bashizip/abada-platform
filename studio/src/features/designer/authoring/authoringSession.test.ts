import { describe, expect, it } from 'vitest';
import type { WorkflowFile } from '@/types';
import { authoringReducer, currentDraft, hasDraft, initialSession, nextRequest, pendingTurn } from './authoringSession';

const workflow = (name: string, ids: string[]): WorkflowFile => ({
  id: 'wf-1', name, version: '1.0.0', updatedAt: '2026-10-20T00:00:00Z', category: 'custom', fileType: 'apl',
  nodes: ids.map((id, i) => ({ id, type: 'human', title: id, description: '', x: i * 100, y: 0 })),
  edges: [],
} as WorkflowFile);

const origin = workflow('Invoice approval', ['received', 'review', 'paid']);

describe('authoring session', () => {
  it('starts from the process it refines, and from nothing for a new one', () => {
    expect(currentDraft(initialSession(origin, 'replace'))).toBe(origin);
    expect(nextRequest(initialSession(origin, 'replace'))).toBe('REFINE');
    const fresh = initialSession(origin, 'new');
    expect(currentDraft(fresh).nodes).toEqual([]);
    expect(nextRequest(fresh)).toBe('CREATE');
    expect(hasDraft(fresh)).toBe(false);
  });

  it('keeps one pending turn and settles it with the answer', () => {
    let state = initialSession(origin, 'new');
    state = authoringReducer(state, { type: 'start', id: 't1', text: 'invoices', request: 'CREATE', at: 1 });
    expect(pendingTurn(state)?.id).toBe('t1');
    // A second prompt while one is pending is ignored.
    expect(authoringReducer(state, { type: 'start', id: 't2', text: 'again', request: 'CREATE', at: 2 })).toBe(state);
    const draft = workflow('Invoice approval', ['a', 'b']);
    state = authoringReducer(state, { type: 'resolve', id: 't1', draft, attempts: 1, warnings: [] });
    expect(pendingTurn(state)).toBeUndefined();
    expect(currentDraft(state)).toBe(draft);
    expect(hasDraft(state)).toBe(true);
    expect(nextRequest(state)).toBe('REFINE');
  });

  it('ignores an answer that arrives after the turn was cancelled', () => {
    let state = initialSession(origin, 'replace');
    state = authoringReducer(state, { type: 'start', id: 't1', text: 'x', request: 'REFINE', at: 1 });
    state = authoringReducer(state, { type: 'cancel', id: 't1' });
    state = authoringReducer(state, { type: 'resolve', id: 't1', draft: workflow('late', ['z']), attempts: 1, warnings: [] });
    expect(state.turns).toEqual([]);
    expect(currentDraft(state)).toBe(origin);
  });

  it('leaves the draft unchanged when a turn fails, and drops the failure on the next prompt', () => {
    let state = initialSession(origin, 'replace');
    state = authoringReducer(state, { type: 'start', id: 't1', text: 'x', request: 'REFINE', at: 1 });
    state = authoringReducer(state, { type: 'fail', id: 't1', error: 'did not validate' });
    expect(state.turns[0]).toMatchObject({ status: 'failed', error: 'did not validate' });
    expect(currentDraft(state)).toBe(origin);
    state = authoringReducer(state, { type: 'start', id: 't2', text: 'y', request: 'REFINE', at: 2 });
    expect(state.turns.map((t) => t.id)).toEqual(['t2']);
  });

  it('undoes to a turn, restores, and drops the set-aside turns on the next prompt', () => {
    let state = initialSession(origin, 'new');
    const first = workflow('v1', ['a']);
    const second = workflow('v2', ['a', 'b']);
    state = authoringReducer(state, { type: 'start', id: 't1', text: 'one', request: 'CREATE', at: 1 });
    state = authoringReducer(state, { type: 'resolve', id: 't1', draft: first, attempts: 1, warnings: [] });
    state = authoringReducer(state, { type: 'start', id: 't2', text: 'two', request: 'REFINE', at: 2 });
    state = authoringReducer(state, { type: 'resolve', id: 't2', draft: second, attempts: 1, warnings: [] });

    state = authoringReducer(state, { type: 'undoTo', id: 't1' });
    expect(currentDraft(state)).toBe(first);
    expect(state.turns[1].setAside).toBe(true);
    expect(authoringReducer(state, { type: 'restore' }).turns[1].setAside).toBe(false);

    state = authoringReducer(state, { type: 'start', id: 't3', text: 'three', request: 'REFINE', at: 3 });
    expect(state.turns.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('makes a direct edit the new draft, one turn per node however many keystrokes', () => {
    let state = initialSession(origin, 'replace');
    const edited = workflow('e1', ['received', 'review']);
    const editedAgain = workflow('e2', ['received']);
    state = authoringReducer(state, { type: 'edit', id: 'e1', nodeId: 'review', text: 'Changed review', draft: edited, at: 1 });
    state = authoringReducer(state, { type: 'edit', id: 'e2', nodeId: 'review', text: 'Changed review', draft: editedAgain, at: 2 });
    expect(state.turns).toHaveLength(1);
    expect(currentDraft(state)).toBe(editedAgain);
    expect(hasDraft(state)).toBe(true);
    state = authoringReducer(state, { type: 'edit', id: 'e3', nodeId: 'paid', text: 'Changed paid', draft: edited, at: 3 });
    expect(state.turns).toHaveLength(2);
  });
});
