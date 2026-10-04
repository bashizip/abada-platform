import { describe, expect, it } from 'vitest';
import type {
  ActivityHistoryDTO,
  ActivityInstanceDTO,
  ProcessInstanceDTO,
} from '@/api/engine';
import type { WorkflowFile, WorkflowNode } from '@/types';
import { deriveInstancePath } from './instanceDetail';

const node = (
  id: string,
  type: WorkflowNode['type'] = 'engine-task',
  subtype?: WorkflowNode['subtype'],
): WorkflowNode => ({
  id,
  type,
  subtype,
  title: id,
  description: id,
  x: 0,
  y: 0,
});

const workflow = (nodes: WorkflowNode[], edges: WorkflowFile['edges']): WorkflowFile => ({
  id: 'workflow',
  name: 'Workflow',
  category: 'custom',
  fileType: 'apl',
  version: '1',
  updatedAt: '2026-08-28T00:00:00Z',
  nodes,
  edges,
});

const instance = (currentActivityId?: string): ProcessInstanceDTO => ({
  id: 'instance',
  processDefinitionId: 'workflow',
  currentActivityId,
  startDate: '2026-08-28T00:00:00Z',
  status: 'RUNNING',
  variables: {},
});

const activity = (activityId: string): ActivityInstanceDTO => ({
  activityId,
  activityName: activityId,
  executionId: `execution-${activityId}`,
});

const completed = (activityId: string): ActivityHistoryDTO => ({
  id: `history-${activityId}`,
  processInstanceId: 'instance',
  processDefinitionId: 'workflow',
  activityId,
  eventType: 'EXTERNAL_TASK_COMPLETED',
  actor: 'worker',
  occurredAt: '2026-08-28T00:00:00Z',
  details: {},
});

describe('deriveInstancePath', () => {
  it('animates only the edge arriving at the active node and its next edges', () => {
    const model = workflow(
      [node('start', 'event', 'start'), node('work'), node('review', 'human'), node('end', 'event', 'end')],
      [
        { id: 'start-work', source: 'start', target: 'work' },
        { id: 'work-review', source: 'work', target: 'review' },
        { id: 'review-end', source: 'review', target: 'end' },
      ],
    );

    const path = deriveInstancePath(
      model,
      instance('review'),
      [activity('review')],
      [completed('start'), completed('work')],
    );

    expect(path.activePathEdgeIds).toEqual(['start-work', 'work-review']);
    expect(path.tokenEdgeIds).toEqual(['work-review']);
    expect(path.nextEdgeIds).toEqual(['review-end']);
  });

  it('uses a sole incoming edge when a synchronous gateway has no history event', () => {
    const model = workflow(
      [
        node('start', 'event', 'start'),
        node('analyze'),
        node('priority', 'gateway', 'exclusive'),
        node('review', 'human'),
        node('standard'),
      ],
      [
        { id: 'start-analyze', source: 'start', target: 'analyze' },
        { id: 'analyze-priority', source: 'analyze', target: 'priority' },
        { id: 'priority-review', source: 'priority', target: 'review' },
        { id: 'priority-standard', source: 'priority', target: 'standard' },
      ],
    );

    const path = deriveInstancePath(
      model,
      instance('review'),
      [activity('review')],
      [completed('start'), completed('analyze')],
    );

    expect(path.activePathEdgeIds).toEqual(['start-analyze']);
    expect(path.tokenEdgeIds).toEqual(['priority-review']);
    expect(path.nextEdgeIds).toEqual([]);
  });

  it('does not guess between multiple unknown incoming edges', () => {
    const model = workflow(
      [node('left'), node('right'), node('merge', 'human')],
      [
        { id: 'left-merge', source: 'left', target: 'merge' },
        { id: 'right-merge', source: 'right', target: 'merge' },
      ],
    );

    const path = deriveInstancePath(model, instance('merge'), [activity('merge')], []);

    expect(path.tokenEdgeIds).toEqual([]);
    expect(path.nextEdgeIds).toEqual([]);
  });
});

describe('deriveInstancePath outcome routes', () => {
  // analyze → review normally; on_low_confidence / on_error also go to review.
  const model = workflow(
    [node('start', 'event', 'start'), node('analyze', 'agent'), node('review', 'human')],
    [
      { id: 'start-analyze', source: 'start', target: 'analyze' },
      { id: 'analyze-review', source: 'analyze', target: 'review' },
      { id: 'analyze-review-low', source: 'analyze', target: 'review', label: 'on_low_confidence' },
      { id: 'analyze-review-invalid', source: 'analyze', target: 'review', label: 'on_invalid_output' },
      { id: 'analyze-review-error', source: 'analyze', target: 'review', label: 'on_error: TIMEOUT' },
    ],
  );
  const agentCompleted = (outcome: string): ActivityHistoryDTO => ({
    ...completed('analyze'),
    details: { agentOutcome: outcome },
  });

  it('does not light outcome routes when the agent result was accepted', () => {
    const path = deriveInstancePath(model, instance('review'), [activity('review')],
      [completed('start'), agentCompleted('OK')]);
    expect(path.activePathEdgeIds).toEqual(['start-analyze', 'analyze-review']);
    expect(path.tokenEdgeIds).toEqual(['analyze-review']);
  });

  it('lights only the outcome route the engine recorded', () => {
    const path = deriveInstancePath(model, instance('review'), [activity('review')],
      [completed('start'), agentCompleted('LOW_CONFIDENCE')]);
    expect(path.activePathEdgeIds).toContain('analyze-review-low');
    expect(path.activePathEdgeIds).not.toContain('analyze-review-invalid');
    expect(path.activePathEdgeIds).not.toContain('analyze-review-error');
  });

  it('lights an error route from the recorded BPMN error and its code', () => {
    const bpmnError = (errorCode: string): ActivityHistoryDTO => ({
      ...completed('analyze'),
      eventType: 'EXTERNAL_TASK_BPMN_ERROR',
      details: { errorCode, routedTo: 'review' },
    });
    const taken = deriveInstancePath(model, instance('review'), [activity('review')],
      [completed('start'), bpmnError('TIMEOUT')]);
    expect(taken.activePathEdgeIds).toContain('analyze-review-error');
    expect(taken.activePathEdgeIds).not.toContain('analyze-review-low');
    const otherCode = deriveInstancePath(model, instance('review'), [activity('review')],
      [completed('start'), bpmnError('QUOTA')]);
    expect(otherCode.activePathEdgeIds).not.toContain('analyze-review-error');
  });

  it('lights the boundary the engine recorded, matching its kind and code', () => {
    const withTimeout = workflow(model.nodes, [
      ...model.edges,
      { id: 'analyze-review-timeout', source: 'analyze', target: 'review', label: 'on_timeout' },
    ]);
    const boundary = (kind: string, code?: string): ActivityHistoryDTO => ({
      ...completed('analyze'),
      eventType: 'BOUNDARY_TAKEN',
      details: { kind, routedTo: 'review', ...(code ? { code } : {}) },
    });
    const timedOut = deriveInstancePath(withTimeout, instance('review'), [activity('review')],
      [completed('start'), boundary('TIMEOUT')]);
    expect(timedOut.activePathEdgeIds).toContain('analyze-review-timeout');
    expect(timedOut.activePathEdgeIds).not.toContain('analyze-review-error');
    const failed = deriveInstancePath(withTimeout, instance('review'), [activity('review')],
      [completed('start'), boundary('ERROR', 'TIMEOUT')]);
    expect(failed.activePathEdgeIds).toContain('analyze-review-error');
    expect(failed.activePathEdgeIds).not.toContain('analyze-review-timeout');
  });
});
