import { describe, expect, it } from 'vitest';
import type { ActivityHistoryDTO, IncidentDTO } from '@/api/engine';
import type { WorkflowFile, WorkflowNode } from '@/types';
import { agentStepModel, canRetryIncidents, offersModelRetry, retryModelOptions } from './incidents';

const node = (patch: Partial<WorkflowNode>): WorkflowNode =>
  ({ id: 'n', type: 'engine-task', title: 'N', description: '', x: 0, y: 0, ...patch });

const workflow = {
  nodes: [
    node({ id: 'draft', type: 'agent', title: 'Draft',
      agentConfig: { model: 'model-a', systemPrompt: '', confidenceThreshold: 0, temperature: 0.2, tools: [] } }),
    node({ id: 'notify', title: 'Notify' }),
  ],
  edges: [],
} as unknown as WorkflowFile;

const retried = (activityId: string, toModel: string, occurredAt: string): ActivityHistoryDTO => ({
  id: occurredAt, processInstanceId: 'p', processDefinitionId: 'd', activityId, eventType: 'INCIDENT_RETRIED',
  actor: 'ops', occurredAt, details: { toModel },
});

const incident = (type: string): IncidentDTO =>
  ({ id: 'i', projectId: 'p', processInstanceId: 'pi', activityId: 'draft', type, createdAt: '2026-10-01T10:00:00Z' });

describe('incident helpers', () => {
  it('lets only project operators and owners retry', () => {
    expect(canRetryIncidents(['OPERATOR'])).toBe(true);
    expect(canRetryIncidents(['VIEWER', 'OWNER'])).toBe(true);
    expect(canRetryIncidents(['MAINTAINER', 'REVIEWER', 'VIEWER'])).toBe(false);
    expect(canRetryIncidents(undefined)).toBe(false);
  });

  it('reads the current model of an agent step, honouring the last operator override', () => {
    expect(agentStepModel(workflow, 'notify')).toBeNull();
    expect(agentStepModel(workflow, 'missing')).toBeNull();
    expect(agentStepModel(workflow, 'draft')).toBe('model-a');
    expect(agentStepModel(workflow, 'draft', [
      retried('draft', 'model-c', '2026-10-01T12:00:00Z'),
      retried('draft', 'model-b', '2026-10-01T11:00:00Z'),
      retried('notify', 'model-x', '2026-10-01T13:00:00Z'),
    ])).toBe('model-c');
  });

  it('offers other allowed models only for failed work on an agent step', () => {
    expect(retryModelOptions(['model-a', 'model-b', 'model-c'], 'model-a')).toEqual(['model-b', 'model-c']);
    expect(offersModelRetry(incident('WORK_FAILED'), 'model-a')).toBe(true);
    expect(offersModelRetry(incident('WORK_FAILED'), null)).toBe(false);
    expect(offersModelRetry(incident('WORK_FAILED'), undefined)).toBe(false);
    expect(offersModelRetry(incident('LOOP_EXHAUSTED'), 'model-a')).toBe(false);
  });
});
