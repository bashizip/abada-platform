import { describe, expect, it } from 'vitest';
import type { WorkflowFile, WorkflowNode } from '@/types';
import { COALESCE_MS, HISTORY_LIMIT, emptyHistory, record, redo, undo, withContent } from './workflowHistory';

const node = (id: string, x = 0): WorkflowNode => ({ id, type: 'agent', title: id, description: '', x, y: 0 } as WorkflowNode);
const workflow = (nodes: WorkflowNode[], meta: Partial<WorkflowFile> = {}): WorkflowFile => ({
  id: 'doc-1', name: 'Flow', category: 'custom', fileType: 'apl', version: '1', updatedAt: 'now',
  nodes, edges: [], documentId: 'doc-1', revision: 3, processKey: 'flow', ...meta,
});

describe('workflow history', () => {
  it('undoes and redoes an edit', () => {
    const before = workflow([node('a')]);
    const after = workflow([node('a'), node('b')]);
    const history = record(emptyHistory(), before, after, 'add', 0);

    const undone = undo(history, after)!;
    expect(withContent(after, undone.content).nodes.map((n) => n.id)).toEqual(['a']);

    const restored = withContent(after, undone.content);
    const redone = redo(undone.history, restored)!;
    expect(withContent(restored, redone.content).nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(undo(redone.history, withContent(restored, redone.content))).not.toBeNull();
  });

  it('keeps persistence metadata when content is restored', () => {
    const before = workflow([node('a')]);
    const after = workflow([node('a'), node('b')]);
    const saved = { ...after, revision: 4, updatedAt: 'later', id: 'doc-1' };
    const undone = undo(record(emptyHistory(), before, after, 'add', 0), saved)!;

    const restored = withContent(saved, undone.content);
    expect(restored.revision).toBe(4);
    expect(restored.updatedAt).toBe('later');
    expect(restored.processKey).toBe('flow');
  });

  it('merges rapid edits of the same kind into one step', () => {
    let history = emptyHistory();
    let current = workflow([node('a', 0)]);
    for (let step = 1; step <= 5; step++) {
      const next = workflow([node('a', step * 8)]);
      history = record(history, current, next, 'move:a', step * (COALESCE_MS / 2));
      current = next;
    }
    expect(history.past).toHaveLength(1);
    expect(undo(history, current)!.content.nodes[0].x).toBe(0);
  });

  it('does not merge different kinds or pauses', () => {
    const a = workflow([node('a', 0)]);
    const b = workflow([node('a', 8)]);
    const c = workflow([node('a', 16)]);
    let history = record(emptyHistory(), a, b, 'move:a', 0);
    history = record(history, b, c, 'move:a', COALESCE_MS + 1);
    expect(history.past).toHaveLength(2);
    history = record(history, c, workflow([node('a', 16), node('b')]), 'add', COALESCE_MS + 2);
    expect(history.past).toHaveLength(3);
  });

  it('ignores edits that change nothing', () => {
    const same = workflow([node('a')]);
    expect(record(emptyHistory(), same, { ...same, revision: 9 }, 'noop', 0).past).toHaveLength(0);
  });

  it('clears redo after a new edit and caps the history', () => {
    const a = workflow([node('a')]);
    const b = workflow([node('b')]);
    const undone = undo(record(emptyHistory(), a, b, 'x', 0), b)!;
    const branched = record(undone.history, a, workflow([node('c')]), 'y', 10_000);
    expect(branched.future).toHaveLength(0);

    let history = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      history = record(history, workflow([node(`n${i}`)]), workflow([node(`n${i + 1}`)]), `k${i}`, i * 10_000);
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0].nodes[0].id).toBe('n20');
  });
});
