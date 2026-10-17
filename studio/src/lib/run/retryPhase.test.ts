import { describe, expect, it } from 'vitest';
import type { ActivityHistoryDTO, FlowTakenDTO } from '@/api/engine';
import { retryFactIds, retryPhase } from './retryPhase';
import { failedAttempts } from './incidents';

let sequence = 0;
const event = (eventType: string, activityId?: string, details: Record<string, unknown> = {}): ActivityHistoryDTO => ({
  id: `h${++sequence}`, processInstanceId: 'instance', processDefinitionId: 'workflow', activityId, eventType,
  actor: 'system', occurredAt: '2026-10-17T00:00:00Z', details,
});
const flow = (from: string, to: string): ActivityHistoryDTO => {
  const taken: FlowTakenDTO = { id: `Flow_${from}_${to}`, from, to, tokenId: 't1' };
  return { ...event('FLOW_TAKEN', from, { flow: taken }), flow: taken };
};

describe('retry phases', () => {
  const failed = event('EXTERNAL_TASK_FAILED', 'charge', { externalTaskId: 'job-1', retries: 0 });
  const retried = event('INCIDENT_RETRIED', 'charge', { incidentId: 'inc-1', type: 'WORK_FAILED' });
  const locked = event('EXTERNAL_TASK_LOCKED', 'charge');
  const completed = event('EXTERNAL_TASK_COMPLETED', 'charge');
  const left = flow('charge', 'notify');
  const after = flow('notify', 'end');
  const history = [event('PROCESS_STARTED', 'start'), flow('start', 'charge'), failed, retried, locked, completed, left, after];

  it('reads retrying, active and completed from the facts shown so far', () => {
    expect(retryPhase(history.slice(0, 3), retried.id)).toBeUndefined();
    expect(retryPhase(history.slice(0, 4), retried.id)).toBe('retrying');
    expect(retryPhase(history.slice(0, 5), retried.id)).toBe('active');
    expect(retryPhase(history.slice(0, 6), retried.id)).toBe('completed');
    expect(retryPhase(history, retried.id)).toBe('completed');
  });

  it('marks a step that waits again (a person, a message) as active', () => {
    const human = event('INCIDENT_RETRIED', 'review', { incidentId: 'inc-2' });
    expect(retryPhase([human], human.id, true)).toBe('active');
    expect(retryPhase([human, event('TASK_COMPLETED', 'review')], human.id, true)).toBe('completed');
  });

  it('fails again only when the attempts are spent; an attempt with retries left runs again', () => {
    const again = event('EXTERNAL_TASK_FAILED', 'charge', { retries: 2 });
    const spent = event('EXTERNAL_TASK_FAILED', 'charge', { retries: 0 });
    expect(retryPhase([retried, locked, again], retried.id)).toBe('retrying');
    expect(retryPhase([retried, locked, again, locked, spent], retried.id)).toBe('failed');
  });

  it('a generic retry that moves the token on is completed by the flow leaving the step', () => {
    const loopRetry = event('INCIDENT_RETRIED', 'draft', { type: 'LOOP_EXHAUSTED' });
    expect(retryPhase([loopRetry, flow('draft', 'review')], loopRetry.id)).toBe('completed');
    expect(retryPhase([loopRetry, flow('other', 'x')], loopRetry.id)).toBe('retrying');
  });

  it('names each fact of a retry, up to the flow that leaves the step, as a paced step', () => {
    const ids = retryFactIds(history);
    expect([...ids]).toEqual([retried.id, locked.id, completed.id, left.id]);
    expect(ids.has(after.id)).toBe(false);
    expect(ids.has(failed.id)).toBe(false);
  });

  it('ends a failed retry at the failure', () => {
    const spent = event('EXTERNAL_TASK_FAILED', 'charge', { retries: 0 });
    const ids = retryFactIds([retried, locked, spent, event('TASK_CREATED', 'charge'), flow('charge', 'x')]);
    expect([...ids]).toEqual([retried.id, locked.id, spent.id]);
  });

  it('counts the failed attempts since the last retry', () => {
    const one = event('EXTERNAL_TASK_FAILED', 'charge', { retries: 2 });
    const two = event('EXTERNAL_TASK_FAILED', 'charge', { retries: 1 });
    expect(failedAttempts([one, two, failed], 'charge')).toBe(3);
    expect(failedAttempts([one, two, failed, retried, one], 'charge')).toBe(1);
    expect(failedAttempts([one], 'other')).toBe(0);
  });
});
