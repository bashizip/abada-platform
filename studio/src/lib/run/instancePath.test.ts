import { describe, expect, it } from 'vitest';
import type {
  ActivityHistoryDTO,
  ActivityInstanceDTO,
  FlowTakenDTO,
  ProcessInstanceDTO,
} from '@/api/engine';
import type { WorkflowEdge, WorkflowFile, WorkflowNode } from '@/types';
import { deriveInstancePath } from './instanceDetail';
import { buildPathView, edgeOfFlow } from './instancePath';
import { EDGE_COLORS } from '@/features/designer/edgeStyle';
import { palette } from '@/lib/tokens';

const node = (id: string, type: WorkflowNode['type'] = 'engine-task', subtype?: WorkflowNode['subtype']): WorkflowNode => ({
  id, type, subtype, title: id, description: id, x: 0, y: 0,
});

const edge = (source: string, target: string, label?: string): WorkflowEdge => ({
  id: `e_${source}_${target}${label ? `_${label.replace(/[^a-z]/gi, '')}` : ''}`, source, target, label,
});

const workflow = (nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowFile => ({
  id: 'workflow', name: 'Workflow', category: 'custom', fileType: 'apl', version: '1',
  updatedAt: '2026-10-17T00:00:00Z', nodes, edges,
});

const instance = (status = 'ACTIVE', currentActivityId?: string): ProcessInstanceDTO => ({
  id: 'instance', processDefinitionId: 'workflow', currentActivityId, startDate: '2026-10-17T00:00:00Z',
  status, variables: {},
});

const waitingAt = (activityId: string): ActivityInstanceDTO => ({
  activityId, activityName: activityId, executionId: `token-${activityId}`,
});

let sequence = 0;
const event = (eventType: string, activityId?: string, details: Record<string, unknown> = {}): ActivityHistoryDTO => ({
  id: `h${++sequence}`, processInstanceId: 'instance', processDefinitionId: 'workflow', activityId, eventType,
  actor: 'system', occurredAt: '2026-10-17T00:00:00Z', details,
});

/** A FLOW_TAKEN event as the 1.2 engine serves it: typed `flow` and the same fact in details. */
const flow = (from: string, to: string, extra: Partial<FlowTakenDTO> = {}): ActivityHistoryDTO => {
  const taken: FlowTakenDTO = { id: `Flow_${from}_${to}`, from, to, tokenId: 't1', loopIteration: null, ...extra };
  return { ...event('FLOW_TAKEN', from, { flow: taken }), flow: taken };
};

const started = () => event('PROCESS_STARTED', 'start');

describe('deriveInstancePath from recorded flows', () => {
  it('numbers a sequential path and marks the finished end', () => {
    const model = workflow(
      [node('start', 'event', 'start'), node('a'), node('b'), node('end', 'event', 'end')],
      [edge('start', 'a'), edge('a', 'b'), edge('b', 'end')],
    );
    const result = deriveInstancePath(model, instance('COMPLETED'), [], [
      started(), flow('start', 'a'), event('EXTERNAL_TASK_COMPLETED', 'a'), flow('a', 'b'), flow('b', 'end'),
    ]);

    expect(result.path.source).toBe('recorded');
    expect(result.path.visits).toEqual({ start: [1], a: [2], b: [3], end: [4] });
    expect(result.activePathEdgeIds).toEqual(['e_start_a', 'e_a_b', 'e_b_end']);
    expect(result.path.now).toEqual({ end: 'ended' });
    // A step without an activity event of its own (b) is still done: the path left it.
    expect(result.statuses.b).toBe('completed');
  });

  it('takes the recorded branch of a condition and says why the others were not reached', () => {
    const model = workflow(
      [node('start', 'event', 'start'), node('check', 'gateway', 'exclusive'), node('approve'), node('decline'),
        node('end', 'event', 'end')],
      [edge('start', 'check'), edge('check', 'approve', 'if score >= 750'), edge('check', 'decline', 'else'),
        edge('approve', 'end'), edge('decline', 'end')],
    );
    const result = deriveInstancePath(model, instance('ACTIVE'), [waitingAt('decline')], [
      started(), flow('start', 'check'), flow('check', 'decline', { else: true }),
    ]);

    expect(result.activePathEdgeIds).toEqual(['e_start_check', 'e_check_decline_else']);
    expect(result.path.decided.check).toEqual(['the else branch']);
    expect(result.path.notReached.approve).toBe('Not reached — the else branch was taken at check');
    expect(result.path.notReached.end).toBe('Not reached yet — the instance is at decline');
    expect(result.tokenEdgeIds).toEqual(['e_check_decline_else']);
    expect(result.path.now.decline).toBe('running');
  });

  it('highlights every parallel branch and counts the arrivals at the join', () => {
    const model = workflow(
      [node('start', 'event', 'start'), node('fork', 'gateway', 'parallel'), node('credit'), node('fraud'),
        node('join', 'gateway', 'parallel'), node('archive')],
      [edge('start', 'fork'), edge('fork', 'credit'), edge('fork', 'fraud'), edge('credit', 'join'),
        edge('fraud', 'join'), edge('join', 'archive')],
    );
    const halfway = deriveInstancePath(model, instance('ACTIVE'), [waitingAt('fraud')], [
      started(), flow('start', 'fork'), flow('fork', 'credit', { tokenId: 'c' }), flow('fork', 'fraud', { tokenId: 'f' }),
      flow('credit', 'join', { tokenId: 'c' }),
    ]);
    expect(halfway.path.joins.join).toEqual({ arrived: 1, expected: 2 });
    expect(halfway.path.visits.join).toEqual([5]);

    const joined = deriveInstancePath(model, instance('ACTIVE'), [waitingAt('archive')], [
      started(), flow('start', 'fork'), flow('fork', 'credit'), flow('fork', 'fraud'), flow('credit', 'join'),
      flow('fraud', 'join'), flow('join', 'archive'),
    ]);
    expect(joined.path.joins.join).toEqual({ arrived: 2, expected: 2 });
    // Both arrivals entered the join: it has two visit numbers.
    expect(joined.path.visits.join).toEqual([5, 6]);
    expect(joined.activePathEdgeIds).toHaveLength(6);
  });

  it('counts the passes of a bounded loop on its nodes and back-edge', () => {
    const model = workflow(
      [node('start', 'event', 'start'), node('draft'), node('review', 'human'), node('decide', 'gateway', 'exclusive'),
        node('done', 'event', 'end')],
      [edge('start', 'draft'), edge('draft', 'review'), edge('review', 'decide'),
        edge('decide', 'done', 'if approved == true'), edge('decide', 'draft', 'else')],
    );
    const result = deriveInstancePath(model, instance('COMPLETED'), [], [
      started(), flow('start', 'draft', { loopIteration: 1 }), flow('draft', 'review'), flow('review', 'decide'),
      flow('decide', 'draft', { else: true, loopIteration: 2 }), flow('draft', 'review'), flow('review', 'decide'),
      flow('decide', 'done', { condition: 'approved == true' }),
    ]);

    expect(result.path.visits.draft).toEqual([2, 5]);
    expect(result.path.visits.decide).toEqual([4, 7]);
    expect(result.path.edgeCounts).toMatchObject({ e_decide_draft_else: 1, e_draft_review: 2, e_decide_done_ifapprovedtrue: 1 });
    expect(result.path.decided.decide).toEqual(['“approved == true”', 'the else branch']);
    expect(result.path.now).toEqual({ done: 'ended' });
  });

  it('follows the review outcome a reviewer chose, not the normal successor between the same nodes', () => {
    const model = workflow(
      [node('start', 'event', 'start'), node('review', 'human'), node('fix'), node('end', 'event', 'end')],
      [edge('start', 'review'), edge('review', 'fix'), edge('review', 'fix', 'outcome: reject'), edge('fix', 'end')],
    );
    const result = deriveInstancePath(model, instance('ACTIVE'), [waitingAt('fix')], [
      started(), flow('start', 'review'), event('TASK_COMPLETED', 'review', { outcome: 'reject' }),
      flow('review', 'fix', { route: { kind: 'OUTCOME', code: 'reject' } }),
    ]);

    expect(result.activePathEdgeIds).toEqual(['e_start_review', 'e_review_fix_outcomereject']);
    expect(result.path.decided.review).toEqual(['outcome “reject”']);
  });

  it('takes the boundary route a step left by, matching an error code to a catch-all on_error', () => {
    const edges = [edge('draft', 'review'), edge('draft', 'manual', 'on_error'), edge('draft', 'manual', 'on_timeout')];
    expect(edgeOfFlow(edges, { from: 'draft', to: 'manual', route: { kind: 'ERROR', code: 'MODEL_DOWN' } })?.label)
      .toBe('on_error');
    expect(edgeOfFlow(edges, { from: 'draft', to: 'manual', route: { kind: 'TIMEOUT' } })?.label).toBe('on_timeout');

    const model = workflow(
      [node('start', 'event', 'start'), node('draft', 'agent'), node('review', 'human'), node('manual', 'human')],
      [edge('start', 'draft'), ...edges],
    );
    const result = deriveInstancePath(model, instance('ACTIVE'), [waitingAt('manual')], [
      started(), flow('start', 'draft'), flow('draft', 'manual', { route: { kind: 'ERROR', code: 'MODEL_DOWN' } }),
    ]);
    expect(result.activePathEdgeIds).toEqual(['e_start_draft', 'e_draft_manual_onerror']);
    expect(result.path.now.manual).toBe('waiting');
    expect(result.path.notReached.review).toBe('Not reached — the error route was taken at draft');
  });

  it('marks an incident mid-path, where no token is waiting', () => {
    const model = workflow(
      [node('start', 'event', 'start'), node('score'), node('notify'), node('end', 'event', 'end')],
      [edge('start', 'score'), edge('score', 'notify'), edge('notify', 'end')],
    );
    const result = deriveInstancePath(model, instance('ACTIVE', 'score'), [], [
      started(), flow('start', 'score'), event('EXTERNAL_TASK_FAILED', 'score'),
    ], { incidentNodeIds: ['score'] });

    expect(result.path.now.score).toBe('incident');
    expect(result.path.visits.score).toEqual([2]);
    expect(result.path.notReached.notify).toBe('Not reached yet — the instance is at score');
  });

  it('tallies the child results of a for-each on the path', () => {
    const model = workflow([node('start', 'event', 'start'), node('batch', 'call-process')], [edge('start', 'batch')]);
    const result = deriveInstancePath(model, instance('ACTIVE'), [waitingAt('batch')], [
      started(), flow('start', 'batch'),
      event('FOR_EACH_ITEM_DONE', 'batch', { ok: true }), event('FOR_EACH_ITEM_DONE', 'batch', { ok: true }),
      event('FOR_EACH_ITEM_DONE', 'batch', { ok: false, code: 'CHILD_FAILED' }),
    ]);
    expect(result.path.children.batch).toEqual({ ok: 2, failed: 1 });
  });

  it('reads the flow from details when the typed field is absent', () => {
    const model = workflow([node('start', 'event', 'start'), node('a')], [edge('start', 'a')]);
    const raw = event('FLOW_TAKEN', 'start', { flow: { id: 'Flow_start_a', from: 'start', to: 'a' } });
    const result = deriveInstancePath(model, instance(), [waitingAt('a')], [started(), raw]);
    expect(result.path.source).toBe('recorded');
    expect(result.activePathEdgeIds).toEqual(['e_start_a']);
  });
});

describe('deriveInstancePath fallback for pre-upgrade history', () => {
  const model = workflow(
    [node('start', 'event', 'start'), node('a'), node('b'), node('c')],
    [edge('start', 'a'), edge('a', 'b'), edge('b', 'c')],
  );

  it('reconstructs the path from the activities touched, and says so', () => {
    const result = deriveInstancePath(model, instance('ACTIVE', 'b'), [waitingAt('b')], [
      started(), event('EXTERNAL_TASK_COMPLETED', 'a'),
    ]);
    expect(result.path.source).toBe('reconstructed');
    expect(result.activePathEdgeIds).toEqual(['e_start_a', 'e_a_b']);
    expect(result.path.visits).toEqual({ start: [1], a: [2], b: [3] });
    expect(result.tokenEdgeIds).toEqual(['e_a_b']);
  });

  it('stays reconstructed when only the part after the upgrade was recorded', () => {
    const result = deriveInstancePath(model, instance('ACTIVE', 'c'), [waitingAt('c')], [
      started(), event('EXTERNAL_TASK_COMPLETED', 'a'), flow('b', 'c'),
    ]);
    expect(result.path.source).toBe('reconstructed');
    expect(result.activePathEdgeIds).toEqual(expect.arrayContaining(['e_start_a', 'e_b_c']));
  });
});

describe('buildPathView for a dry run', () => {
  it('draws the edges the dry run chose like an instance path', () => {
    const model = workflow(
      [node('start', 'event', 'start'), node('check', 'gateway', 'exclusive'), node('yes'), node('no')],
      [edge('start', 'check'), edge('check', 'yes', 'if ok'), edge('check', 'no', 'else')],
    );
    const view = buildPathView(model, {
      entry: 'start', steps: [{ edge: model.edges[0] }, { edge: model.edges[1] }], statuses: {},
      activeNodeIds: ['yes'], incidentNodeIds: [], status: 'ACTIVE', source: 'recorded',
    });
    expect(view.visits).toEqual({ start: [1], check: [2], yes: [3] });
    expect(view.decided.check).toEqual(['“ok”']);
    expect(view.notReached.no).toBe('Not reached — “ok” was taken at check');
  });
});

/** WCAG relative luminance of a #RRGGBB colour. */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('path colour', () => {
  it('keeps at least 3:1 contrast against the canvas', () => {
    const ratio = (luminance(EDGE_COLORS.path) + 0.05) / (luminance(palette.charcoal) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});

describe('not reached', () => {
  it('prefers the step a token is stopped at over a branch the path did not take', () => {
    const model = workflow(
      [node('start', 'event', 'start'), node('check', 'gateway', 'exclusive'), node('wait', 'event', 'message'),
        node('ship', 'human')],
      [edge('start', 'check'), edge('check', 'wait', 'if amount > 100'), edge('check', 'ship', 'else'), edge('wait', 'ship')],
    );
    const result = deriveInstancePath(model, instance('RUNNING'), [], [
      started(), flow('start', 'check'), flow('check', 'wait', { condition: 'amount > 100' }),
    ], { incidentNodeIds: ['wait'] });
    expect(result.path.now.wait).toBe('incident');
    expect(result.path.notReached.ship).toBe('Not reached yet — the instance is at wait');
  });
});
