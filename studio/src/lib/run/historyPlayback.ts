import type { ActivityHistoryDTO, ActivityInstanceDTO, ProcessInstanceDTO } from '@/api/engine';
import type { WorkflowFile } from '@/types';
import { recordedFlows } from '@/lib/run/instancePath';

/**
 * What an instance view plays back (M5 S3): the instance history, one step per
 * sequence flow taken (FLOW_TAKEN). The spec orders playback by outbox event
 * id, but FLOW_TAKEN rows are not on the outbox stream (S2): the views refetch
 * the history on each stream event instead, and the history is ordered by
 * `occurredAt`, strictly increasing within a command. History ids deduplicate.
 */
export const historyFactId = (event: ActivityHistoryDTO): string => event.id;

export const isFlowStep = (event: ActivityHistoryDTO): boolean => event.eventType === 'FLOW_TAKEN';

const flowOf = (event: ActivityHistoryDTO) =>
  event.flow ?? (event.details?.flow as { from?: string; to?: string } | undefined);

export interface PlaybackOrder {
  /** The history in playback order: within one command, the branches of a split side by side. */
  ordered: ActivityHistoryDTO[];
  /** Flows that advance as one visible step share a key (same command, same wave). */
  stepKeyOf: Map<string, string>;
}

/**
 * The order the history is played in. The engine records the flows of one
 * command depth-first (a parallel split runs its first branch to the join
 * before the second branch starts), all inside one transaction. Played as is,
 * the branches would not advance together. Within each run of one command's
 * flows (contiguous, at most 1 ms apart), flows are put in waves instead: a
 * flow's wave is one more than the wave of the flow that brought its token
 * to its source. Each wave is one visible step. Both orders serialise the
 * same atomic transaction, so every frame is still a state the facts imply.
 * Runs never mix commands, and every other row keeps its place.
 */
export function playbackOrder(history: ActivityHistoryDTO[]): PlaybackOrder {
  const ordered: ActivityHistoryDTO[] = [];
  const stepKeyOf = new Map<string, string>();
  let index = 0;
  while (index < history.length) {
    if (!isFlowStep(history[index])) {
      ordered.push(history[index]);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < history.length && isFlowStep(history[end])
      && Math.abs(Date.parse(history[end].occurredAt) - Date.parse(history[end - 1].occurredAt)) <= 1) end += 1;
    const run = history.slice(index, end);
    const waves = run.map(() => 0);
    run.forEach((event, at) => {
      const from = flowOf(event)?.from;
      for (let back = at - 1; back >= 0; back -= 1) {
        if (flowOf(run[back])?.to === from) { waves[at] = waves[back] + 1; break; }
      }
    });
    run.map((event, at) => ({ event, wave: waves[at], at }))
      .sort((a, b) => a.wave - b.wave || a.at - b.at)
      .forEach(({ event, wave }) => {
        ordered.push(event);
        stepKeyOf.set(event.id, `${index}:${wave}`);
      });
    index = end;
  }
  return { ordered, stepKeyOf };
}

const URGENT_EVENTS = new Set([
  'TASK_FAILED', 'EXTERNAL_TASK_FAILED', 'PROCESS_FAILED', 'INSTANCE_FAILED', 'PROCESS_CANCELLED', 'INSTANCE_CANCELLED',
]);

/** Facts never held back: failures, the end of the instance, and a task assigned to the viewer. */
export function urgentHistoryFact(currentUser: string | undefined): (event: ActivityHistoryDTO) => boolean {
  return (event) => URGENT_EVENTS.has(event.eventType)
    || (!!currentUser && event.eventType === 'TASK_ASSIGNED' && event.details?.assignee === currentUser);
}

/** The urgent conditions of the real state: a terminal status or an open incident. */
export function urgentStateKey(instance: ProcessInstanceDTO | null | undefined, incidentNodeIds: string[] = []): string {
  const status = (instance?.status ?? '').toUpperCase();
  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) ? status : '';
  const incidents = [...incidentNodeIds].sort().join(',');
  return terminal || incidents ? `${terminal}|${incidents}` : '';
}

/**
 * Where the tokens were once the visible history had happened: every node a
 * flow entered and no later flow left (a join waiting for its other branch
 * counts, an end event does not). Returned as the instance and activities the
 * canvas derivation reads, so a replayed frame is drawn like a live one.
 */
export function instanceAtPrefix(
  workflow: WorkflowFile,
  instance: ProcessInstanceDTO,
  visibleHistory: ActivityHistoryDTO[],
): { instance: ProcessInstanceDTO; activities: ActivityInstanceDTO[] } {
  const lastEntry = new Map<string, number>();
  const lastExit = new Map<string, number>();
  recordedFlows(visibleHistory).forEach((flow, index) => {
    lastEntry.set(flow.to, index);
    lastExit.set(flow.from, index);
  });
  const ends = new Set(workflow.nodes.filter((node) => node.type === 'event' && node.subtype === 'end').map((node) => node.id));
  const active = [...lastEntry.entries()]
    .filter(([nodeId, entered]) => !ends.has(nodeId) && entered > (lastExit.get(nodeId) ?? -1))
    .map(([nodeId]) => nodeId);
  if (lastEntry.size === 0) {
    const start = visibleHistory.find((event) => event.eventType === 'PROCESS_STARTED')?.activityId;
    if (start) active.push(start);
  }
  return {
    // Mid-replay the instance was running, whatever it is now.
    instance: { ...instance, status: 'ACTIVE', endDate: undefined, suspended: false, currentActivityId: active[0] },
    activities: active.map((activityId) => ({ activityId, activityName: '', executionId: '' })),
  };
}
