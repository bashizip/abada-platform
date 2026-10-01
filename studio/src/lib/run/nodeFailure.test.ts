import { describe, expect, it } from 'vitest';
import type { ActivityHistoryDTO, ProjectJob } from '@/api/engine';
import { aggregateNodeTelemetry } from './instanceDetail';
import { failureOf } from './errorReport';

const failed = (id: string, details: Record<string, unknown>): ActivityHistoryDTO => ({
  id, processInstanceId: 'pi-1', processDefinitionId: 'lead_triage', activityId: 'analyze-lead',
  eventType: 'EXTERNAL_TASK_FAILED', actor: 'worker', occurredAt: '2026-09-30T21:00:52Z', details,
});

describe('agent failure details', () => {
  it('links a failure event to its job and attempt context', () => {
    const failure = failureOf(failed('e1', {
      externalTaskId: 'job-7', retries: 1,
      agent: { errorType: 'AgentConfigurationException', attempt: 2, provider: 'google-gemini', model: 'gemini-3.6-flash' },
    }), 'Analyze-Lead', ['w-1', 'w-2']);

    expect(failure?.jobId).toBe('job-7');
    expect(failure?.context).toMatchObject({
      activityTitle: 'Analyze-Lead', errorType: 'AgentConfigurationException', attempt: 2,
      provider: 'google-gemini', model: 'gemini-3.6-flash', workerId: 'w-2',
    });
  });

  it('ignores other events and failures without a job id', () => {
    expect(failureOf({ ...failed('e2', { externalTaskId: 'job-7' }), eventType: 'EXTERNAL_TASK_LOCKED' }, 'A', [])).toBeNull();
    expect(failureOf(failed('e3', {}), 'A', [])).toBeNull();
  });

  it('uses only this instance\'s job from the project-wide job list', () => {
    const jobs: ProjectJob[] = [
      { id: 'other', processInstanceId: 'pi-2', activityId: 'analyze-lead', exceptionMessage: 'someone else', retries: 0 },
      { id: 'mine', processInstanceId: 'pi-1', activityId: 'analyze-lead', exceptionMessage: 'mine', retries: 0 },
    ];
    const telemetry = aggregateNodeTelemetry([failed('e4', { externalTaskId: 'mine' })], 'analyze-lead', jobs);
    expect(telemetry.errorMessage).toBe('mine');
  });
});
