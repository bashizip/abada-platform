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
