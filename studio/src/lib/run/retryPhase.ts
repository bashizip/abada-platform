import type { ActivityHistoryDTO } from '@/api/engine';
import { recordedFlows } from '@/lib/run/instancePath';

/**
 * Where a retried step is (M5 S4), read from the history recorded after its
 * `INCIDENT_RETRIED` row, never guessed:
 *
 * - `retrying`: the retry is recorded and the work reopened; nobody has it yet.
 * - `active`: a worker locked the work, a person has the task, or a child runs.
 * - `completed`: the work completed or the token left the step.
 * - `failed`: the work failed again (a new incident may follow).
 */
export type RetryPhase = 'retrying' | 'active' | 'completed' | 'failed';

const ACTIVE = new Set(['EXTERNAL_TASK_LOCKED', 'TASK_CLAIMED', 'TASK_ASSIGNED', 'CHILD_STARTED', 'DELEGATION_STARTED']);
const COMPLETED = new Set(['EXTERNAL_TASK_COMPLETED', 'TASK_COMPLETED', 'CHILD_COMPLETED', 'DELEGATION_COMPLETED',
  'EVENT_CORRELATED']);
const FAILED = new Set(['EXTERNAL_TASK_FAILED', 'TASK_FAILED', 'LOOP_EXHAUSTED', 'CHILD_FAILED', 'TOOL_OUTCOME_UNKNOWN']);

export const isFinalPhase = (phase: RetryPhase | undefined): boolean => phase === 'completed' || phase === 'failed';

const leaves = (event: ActivityHistoryDTO, nodeId: string): boolean =>
  event.eventType === 'FLOW_TAKEN' && recordedFlows([event])[0]?.from === nodeId;

/** The phase a fact moves a retried step to, or null when it says nothing about it. */
function phaseOf(event: ActivityHistoryDTO, nodeId: string): RetryPhase | null {
  if (leaves(event, nodeId)) return 'completed';
  if (event.activityId !== nodeId) return null;
  // An attempt that failed with attempts left runs again: the step is back to waiting for a worker.
  if (event.eventType === 'EXTERNAL_TASK_FAILED' && typeof event.details?.retries === 'number'
    && event.details.retries > 0) return 'retrying';
  if (FAILED.has(event.eventType)) return 'failed';
  if (COMPLETED.has(event.eventType)) return 'completed';
  if (ACTIVE.has(event.eventType)) return 'active';
  return null;
}

/**
 * Phase of the retry recorded by the history row `retriedId`, in `history`
 * (the facts shown so far). Undefined while that row is not in it. A token
 * that waits at the step again (a person to act, a message to arrive) is
 * active: the step is doing what it is for.
 */
export function retryPhase(history: readonly ActivityHistoryDTO[], retriedId: string,
  waitingAgain = false): RetryPhase | undefined {
  const at = history.findIndex((event) => event.id === retriedId);
  if (at < 0) return undefined;
  const nodeId = history[at].activityId ?? '';
  let phase: RetryPhase = waitingAgain ? 'active' : 'retrying';
  for (const event of history.slice(at + 1)) {
    if (event.eventType === 'INCIDENT_RETRIED' && event.activityId === nodeId) break;
    const next = phaseOf(event, nodeId);
    if (!next) continue;
    phase = next;
    if (isFinalPhase(phase)) break;
  }
  return phase;
}

/**
 * The facts that make up each retry, in order: its `INCIDENT_RETRIED` row and
 * the facts that move the step on, up to the one that ends the retry
 * (completed or failed) and the flow that leaves the step. Playback shows
 * each as its own step, so a retry the engine resolves in milliseconds is
 * still seen passing through retrying → active → completed/failed.
 */
export function retryFactIds(history: readonly ActivityHistoryDTO[]): Set<string> {
  const ids = new Set<string>();
  history.forEach((retried, at) => {
    if (retried.eventType !== 'INCIDENT_RETRIED') return;
    ids.add(retried.id);
    const nodeId = retried.activityId ?? '';
    let ended = false;
    for (const event of history.slice(at + 1)) {
      if (event.eventType === 'INCIDENT_RETRIED' && event.activityId === nodeId) break;
      const phase = phaseOf(event, nodeId);
      if (!phase) continue;
      const left = leaves(event, nodeId);
      if (ended && !left) break;
      ids.add(event.id);
      if (left || phase === 'failed') break;
      if (phase === 'completed') ended = true;
    }
  });
  return ids;
}
