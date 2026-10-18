import { describe, expect, it } from 'vitest';
import type { ActivityHistoryDTO, FlowTakenDTO } from '@/api/engine';
import type { WorkflowFile, WorkflowNode } from '@/types';
import { buildAuditTrail, type NodeTrailEntry } from './auditTrail';

const node = (id: string, type: WorkflowNode['type'], extra: Partial<WorkflowNode> = {}): WorkflowNode =>
  ({ id, type, title: id[0].toUpperCase() + id.slice(1), description: '', x: 0, y: 0, ...extra });
const workflow: WorkflowFile = {
  id: 'p', name: 'p', category: 'custom', fileType: 'apl', version: '1', updatedAt: '2026-10-17T00:00:00Z',
  nodes: [
    node('start', 'event', { subtype: 'start' }),
    node('review', 'human'),
    node('score', 'agent', { agentConfig: { model: 'gpt-4o-mini', systemPrompt: 'secret prompt', confidenceThreshold: 0, temperature: 0, tools: [] } }),
    node('charge', 'engine-task'),
    node('route', 'gateway', { subtype: 'exclusive' }),
    node('rules', 'dmn'),
    node('split', 'gateway', { subtype: 'parallel' }),
    node('a', 'script'),
    node('b', 'script'),
    node('join', 'gateway', { subtype: 'parallel' }),
    node('done', 'event', { subtype: 'end' }),
  ],
  edges: [],
};

let sequence = 0;
const at = (ms: number) => new Date(Date.UTC(2026, 9, 17, 10, 0, 0, ms)).toISOString();
const event = (eventType: string, activityId: string | undefined, ms: number, details: Record<string, unknown> = {},
  actor = 'system'): ActivityHistoryDTO => ({
  id: `h${++sequence}`, processInstanceId: 'i', processDefinitionId: 'p', activityId, eventType, actor,
  occurredAt: at(ms), details,
});
const flow = (from: string, to: string, ms: number, extra: Partial<FlowTakenDTO> = {}): ActivityHistoryDTO => {
  const taken: FlowTakenDTO = { id: `Flow_${from}_${to}`, from, to, tokenId: 't', ...extra };
  return { ...event('FLOW_TAKEN', from, ms, { flow: taken }), flow: taken };
};
const nodeEntries = (entries: ReturnType<typeof buildAuditTrail>) =>
  entries.filter((entry): entry is NodeTrailEntry => entry.kind === 'node');

describe('the audit trail of an instance', () => {
  it('tells one entry per pass, with the facts written after the flow that left the node', () => {
    // As the engine records an external task: the flow out first, then the completion of the work.
    const history = [
      event('PROCESS_STARTED', 'start', 0, {}, 'alice'),
      flow('start', 'charge', 10),
      event('EXTERNAL_TASK_LOCKED', 'charge', 400, { externalTaskId: 'job', workerId: 'pay-1', topic: 'charge' }),
      flow('charge', 'route', 900),
      event('EVENT_CORRELATED', 'charge', 905),
      event('EXTERNAL_TASK_COMPLETED', 'charge', 910, { externalTaskId: 'job', workerId: 'pay-1' }),
      flow('route', 'done', 911, { condition: 'amount >= 1000' }),
    ];
    const entries = buildAuditTrail(history, workflow);
    expect(entries.map((entry) => entry.kind === 'node' ? entry.nodeId : entry.action))
      .toEqual(['Instance started', 'charge', 'route', 'done']);
    const [, charge, route, done] = entries as [unknown, NodeTrailEntry, NodeTrailEntry, NodeTrailEntry];
    expect(charge.actor).toEqual({ kind: 'worker', name: 'pay-1' });
    expect(charge.status).toBe('completed');
    expect(charge.facts.map((fact) => fact.eventType))
      .toEqual(['FLOW_TAKEN', 'EXTERNAL_TASK_LOCKED', 'FLOW_TAKEN', 'EVENT_CORRELATED', 'EXTERNAL_TASK_COMPLETED']);
    // From the token's arrival to the fact that ended the pass.
    expect(charge.durationMs).toBe(900);
    expect(charge.exit).toBe('→ Route');
    expect(route).toMatchObject({ actor: { kind: 'engine' }, action: 'Routed the token', exit: '→ Done (amount >= 1000)' });
    expect(route.durationMs).toBeUndefined();
    expect(done).toMatchObject({ action: 'Reached the end', status: 'completed' });
  });

  it('shows a running pass, then the same entry failed, retried and completed', () => {
    const opening = [
      event('PROCESS_STARTED', 'start', 0),
      flow('start', 'charge', 1),
      event('EXTERNAL_TASK_LOCKED', 'charge', 2, { externalTaskId: 'job', workerId: 'w' }),
    ];
    expect(nodeEntries(buildAuditTrail(opening, workflow))[0]).toMatchObject({ status: 'running', action: 'Working' });

    const failed = [...opening, event('EXTERNAL_TASK_FAILED', 'charge', 50, { externalTaskId: 'job', retries: 0 })];
    expect(nodeEntries(buildAuditTrail(failed, workflow))[0]).toMatchObject({ status: 'failed', action: 'Failed' });

    const retried = [...failed,
      event('VARIABLES_UPDATED', undefined, 60, { variableNames: ['card_ok'] }, 'alice'),
      event('INCIDENT_RETRIED', 'charge', 70, { incidentId: 'inc', retries: 3 }, 'alice'),
      event('EXTERNAL_TASK_LOCKED', 'charge', 80, { externalTaskId: 'job', workerId: 'w' }),
      flow('charge', 'done', 90),
      event('EXTERNAL_TASK_COMPLETED', 'charge', 95, { externalTaskId: 'job' }),
    ];
    const entries = buildAuditTrail(retried, workflow);
    const charge = nodeEntries(entries)[0];
    expect(charge).toMatchObject({ status: 'completed', action: 'Completed', id: opening[1].id });
    expect(charge.facts.some((fact) => fact.eventType === 'INCIDENT_RETRIED')).toBe(true);
    // The variable fix is about the instance, not a step.
    expect(entries.find((entry) => entry.kind === 'instance' && entry.action === 'Variables updated'))
      .toMatchObject({ actorName: 'alice' });
  });

  it('names the person, the outcome and whether they commented, never the comment', () => {
    const history = [
      flow('start', 'review', 0),
      event('TASK_CREATED', 'review', 5, { assignee: '', assignmentStrategy: 'CLAIM' }),
    ];
    expect(nodeEntries(buildAuditTrail(history, workflow))[0])
      .toMatchObject({ status: 'waiting', action: 'Waiting for a person', actor: { kind: 'human' } });
    const decided = [...history,
      event('TASK_CLAIMED', 'review', 1000, { assignee: 'bob' }, 'bob'),
      event('TASK_COMPLETED', 'review', 3005, { outcome: 'APPROVE', commented: true, commentLength: 42 }, 'bob'),
      flow('review', 'done', 3010, { route: { kind: 'OUTCOME', code: 'APPROVE' } }),
    ];
    const review = nodeEntries(buildAuditTrail(decided, workflow))[0];
    expect(review).toMatchObject({
      actor: { kind: 'human', name: 'bob' }, outcome: 'APPROVE', commentLength: 42, action: 'Decided APPROVE',
      durationMs: 3005, exit: '→ Done (outcome APPROVE)',
    });
    expect(JSON.stringify(review)).not.toContain('comment text');
  });

  it('gives an agent its model and prompt version, else the start of its prompt hash', () => {
    const history = [
      flow('start', 'score', 0),
      event('EXTERNAL_TASK_LOCKED', 'score', 10, { externalTaskId: 'job-a', workerId: 'abada-agent' }),
      flow('score', 'done', 2000),
      event('EXTERNAL_TASK_COMPLETED', 'score', 2010, {
        externalTaskId: 'job-a', agent: { model: 'gpt-4o', promptHash: 'a1b2c3d4e5f6a7b8', durationMs: 1830 },
      }),
    ];
    const hashed = nodeEntries(buildAuditTrail(history, workflow))[0];
    expect(hashed.actor).toEqual({ kind: 'agent', model: 'gpt-4o', prompt: '#a1b2c3d4' });
    expect(hashed.durationMs).toBe(1830);
    expect(hashed.externalTaskIds).toEqual(['job-a']);
    expect(JSON.stringify(hashed)).not.toContain('secret prompt');

    const versioned = nodeEntries(buildAuditTrail(history, workflow, new Map([['job-a', 'triage@3']])))[0];
    expect(versioned.actor.prompt).toBe('triage@3');
    // Before it runs, the declared model.
    expect(nodeEntries(buildAuditTrail(history.slice(0, 1), workflow))[0].actor)
      .toMatchObject({ kind: 'agent', model: 'gpt-4o-mini' });
  });

  it('numbers the decision-table rules that matched from 1', () => {
    const history = [
      flow('start', 'rules', 0),
      event('DECISION_TABLE_APPLIED', 'rules', 0, { decisionKey: 'risk', matchedRuleIndexes: [0, 2], inputNames: ['score'] }),
      flow('rules', 'done', 0),
    ];
    expect(nodeEntries(buildAuditTrail(history, workflow))[0])
      .toMatchObject({ matchedRules: [1, 3], action: 'Applied rules #1, #3' });
  });

  it('reads each matched rule from the definition: its condition and outputs, inputs by name only', () => {
    const table: WorkflowFile = { ...workflow, nodes: workflow.nodes.map((candidate) => (candidate.id === 'rules'
      ? { ...candidate, dmnConfig: { decisionKey: 'risk', hitPolicy: 'FIRST', inputs: [{ name: 'score' }], outputs: [],
        rules: [
          { id: 'r0', when: 'score >= 750', then: { tier: 'A' } },
          { id: 'r1', when: 'score >= 600', then: { tier: 'B', review: true } },
          { id: 'r2', otherwise: true, then: { tier: 'C' } },
        ] } }
      : candidate)) };
    const applied = (indexes: number[]) => nodeEntries(buildAuditTrail([
      flow('start', 'rules', 0),
      event('DECISION_TABLE_APPLIED', 'rules', 0, { decisionKey: 'risk', matchedRuleIndexes: indexes,
        inputNames: ['score'], outputNames: ['tier', 'review'] }),
      flow('rules', 'done', 0),
    ], table))[0];
    expect(applied([1]).decision).toEqual({ decisionKey: 'risk', inputNames: ['score'], outputNames: ['tier', 'review'],
      rules: [{ number: 2, otherwise: false, when: 'score >= 600', then: { tier: 'B', review: true } }] });
    expect(applied([2])).toMatchObject({ action: 'Applied the fallback (rule #3)',
      decision: { rules: [{ number: 3, otherwise: true, then: { tier: 'C' } }] } });
  });

  it('keeps one pass per branch of a parallel split and one for the join', () => {
    const history = [
      flow('start', 'split', 0),
      flow('split', 'a', 0), flow('split', 'b', 0),
      flow('a', 'join', 0), flow('b', 'join', 0),
      flow('join', 'done', 0),
    ];
    const entries = nodeEntries(buildAuditTrail(history, workflow));
    expect(entries.map((entry) => entry.nodeId)).toEqual(['split', 'a', 'b', 'join', 'done']);
    expect(entries[0].exit).toBe('→ A, → B');
    expect(entries[3].facts.filter((fact) => fact.flow?.to === 'join')).toHaveLength(2);
    const waiting = nodeEntries(buildAuditTrail(history.slice(0, 4), workflow))[3];
    expect(waiting).toMatchObject({ nodeId: 'join', status: 'running', action: 'Waiting for the other branches' });
  });

  it('starts a new pass each time a loop comes back to a node', () => {
    const history = [flow('start', 'charge', 0), flow('charge', 'route', 1), flow('route', 'charge', 2),
      flow('charge', 'route', 3)];
    expect(nodeEntries(buildAuditTrail(history, workflow)).map((entry) => entry.nodeId))
      .toEqual(['charge', 'route', 'charge', 'route']);
  });
});
