import { describe, expect, it } from 'vitest';
import type { ActivityHistoryDTO, FlowTakenDTO, ProcessInstanceDTO } from '@/api/engine';
import type { WorkflowEdge, WorkflowFile, WorkflowNode } from '@/types';
import { deriveInstancePath } from './instanceDetail';
import {
  instanceAtPrefix,
  playbackOrder,
  urgentHistoryFact,
  urgentStateKey,
} from './historyPlayback';
import { stepEnds } from '@/hooks/usePacedPlayback';
import { isFlowStep } from './historyPlayback';
import { pathArrivals } from '@/features/designer/pathArrivals';

const node = (id: string, type: WorkflowNode['type'] = 'engine-task', subtype?: WorkflowNode['subtype']): WorkflowNode => ({
  id, type, subtype, title: id, description: id, x: 0, y: 0,
});
const edge = (source: string, target: string): WorkflowEdge => ({ id: `e_${source}_${target}`, source, target });
const model: WorkflowFile = {
  id: 'workflow', name: 'Workflow', category: 'custom', fileType: 'apl', version: '1', updatedAt: '2026-10-17T00:00:00Z',
  nodes: [node('start', 'event', 'start'), node('fork', 'gateway', 'parallel'), node('a'), node('b'),
    node('join', 'gateway', 'parallel'), node('review', 'human'), node('end', 'event', 'end')],
  edges: [edge('start', 'fork'), edge('fork', 'a'), edge('fork', 'b'), edge('a', 'join'), edge('b', 'join'),
    edge('join', 'review'), edge('review', 'end')],
};
const instance = (status = 'ACTIVE'): ProcessInstanceDTO => ({
  id: 'instance', processDefinitionId: 'workflow', startDate: '2026-10-17T00:00:00Z', status, variables: {},
});

let sequence = 0;
const event = (eventType: string, activityId?: string, details: Record<string, unknown> = {}): ActivityHistoryDTO => ({
  id: `h${++sequence}`, processInstanceId: 'instance', processDefinitionId: 'workflow', activityId, eventType,
  actor: 'system', occurredAt: '2026-10-17T00:00:00Z', details,
});
const flow = (from: string, to: string, at = '2026-10-17T00:00:00Z'): ActivityHistoryDTO => {
  const taken: FlowTakenDTO = { id: `Flow_${from}_${to}`, from, to, tokenId: 't1' };
  return { ...event('FLOW_TAKEN', from, { flow: taken }), flow: taken, occurredAt: at };
};

const history = [
  event('PROCESS_STARTED', 'start'),
  flow('start', 'fork'), flow('fork', 'a'), flow('fork', 'b'),
  flow('a', 'join'),
  flow('b', 'join'), flow('join', 'review'), event('TASK_CREATED', 'review'),
];

describe('instanceAtPrefix', () => {
  it('puts the tokens where the replayed moment had them, never ahead', () => {
    expect(instanceAtPrefix(model, instance(), history.slice(0, 1)).activities.map((a) => a.activityId)).toEqual(['start']);
    expect(instanceAtPrefix(model, instance(), history.slice(0, 4)).activities.map((a) => a.activityId)).toEqual(['a', 'b']);
    // One branch at the join, the other still running.
    expect(instanceAtPrefix(model, instance(), history.slice(0, 5)).activities.map((a) => a.activityId))
      .toEqual(['b', 'join']);
    expect(instanceAtPrefix(model, instance('COMPLETED'), history).activities.map((a) => a.activityId)).toEqual(['review']);
  });

  it('draws a replayed frame like a live one, as a prefix of the real path', () => {
    const at = instanceAtPrefix(model, instance('COMPLETED'), history.slice(0, 4));
    expect(at.instance.status).toBe('ACTIVE');
    const replayed = deriveInstancePath(model, at.instance, at.activities, history.slice(0, 4));
    expect(Object.keys(replayed.path.edgeCounts)).toEqual(['e_start_fork', 'e_fork_a', 'e_fork_b']);
    expect(replayed.path.now).toEqual({ a: 'running', b: 'running' });
    expect(replayed.path.visits.review).toBeUndefined();
  });

  it('advances the branches of a split together, even when the engine recorded them depth-first', () => {
    // One command: the engine ran branch a to the join before branch b started.
    const command = [
      event('TASK_COMPLETED', 'start'),
      flow('start', 'fork'), flow('fork', 'a'), flow('a', 'join'), flow('fork', 'b'), flow('b', 'join'),
      flow('join', 'review'), event('TASK_CREATED', 'review'),
    ];
    const { ordered, stepKeyOf } = playbackOrder(command);
    const hop = (e: ActivityHistoryDTO) => e.flow ? `${e.flow.from}>${e.flow.to}` : e.eventType;
    expect(ordered.map(hop)).toEqual(['TASK_COMPLETED', 'start>fork', 'fork>a', 'fork>b', 'a>join', 'b>join',
      'join>review', 'TASK_CREATED']);
    const sameStep = (a: ActivityHistoryDTO, b: ActivityHistoryDTO) => stepKeyOf.get(a.id) === stepKeyOf.get(b.id);
    // start→fork | both branches leave the split | both arrive at the join | join→review (+ the task created)
    expect(stepEnds(ordered, isFlowStep, sameStep)).toEqual([2, 4, 6, 7]);
  });

  it('never mixes the flows of two commands', () => {
    const two = [flow('start', 'fork', '2026-10-17T00:00:00.000Z'), flow('fork', 'a', '2026-10-17T00:00:00.000001Z'),
      flow('fork', 'b', '2026-10-17T00:00:05.000Z')];
    const { ordered, stepKeyOf } = playbackOrder(two);
    expect(ordered.map((e) => e.id)).toEqual(two.map((e) => e.id));
    expect(stepKeyOf.get(two[1].id)).not.toEqual(stepKeyOf.get(two[2].id));
  });
});

describe('urgent facts', () => {
  it('never holds back failures or a task assigned to the viewer', () => {
    const urgent = urgentHistoryFact('alice');
    expect(urgent(event('TASK_ASSIGNED', 'review', { assignee: 'alice' }))).toBe(true);
    expect(urgent(event('TASK_ASSIGNED', 'review', { assignee: 'bob' }))).toBe(false);
    expect(urgent(event('EXTERNAL_TASK_FAILED', 'a'))).toBe(true);
    expect(urgent(flow('a', 'join'))).toBe(false);
  });

  it('keys the urgent real state: terminal status and open incidents', () => {
    expect(urgentStateKey(instance('ACTIVE'))).toBe('');
    expect(urgentStateKey(instance('COMPLETED'))).toBe('COMPLETED|');
    expect(urgentStateKey(instance('ACTIVE'), ['b', 'a'])).toBe('|a,b');
  });
});

describe('pathArrivals', () => {
  it('reports the edges taken once more and the nodes entered once more', () => {
    const before = deriveInstancePath(model, instance(), [], history.slice(0, 2)).path;
    const after = deriveInstancePath(model, instance(), [], history.slice(0, 4)).path;
    const arrivals = pathArrivals(before, after);
    expect([...arrivals.edges]).toEqual(['e_fork_a', 'e_fork_b']);
    expect([...arrivals.nodes]).toEqual(['a', 'b']);
  });
});
