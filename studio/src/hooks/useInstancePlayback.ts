import { useCallback, useMemo } from 'react';
import type { ActivityHistoryDTO, ActivityInstanceDTO, ProcessInstanceDTO } from '@/api/engine';
import type { WorkflowFile } from '@/types';
import { getUserFromToken, keycloak } from '@/auth/keycloakClient';
import { usePacedPlayback, type PacedPlayback } from '@/hooks/usePacedPlayback';
import {
  historyFactId,
  instanceAtPrefix,
  isFlowStep,
  playbackOrder,
  urgentHistoryFact,
  urgentStateKey,
} from '@/lib/run/historyPlayback';
import { retryFactIds } from '@/lib/run/retryPhase';

export interface InstanceFrame {
  /** The facts the canvas draws: the real ones, or those of the replayed moment while lagging. */
  instance: ProcessInstanceDTO;
  activities: ActivityInstanceDTO[];
  history: ActivityHistoryDTO[];
}

/**
 * The facts the audit trail shows (M5 S5): the visible prefix, plus the facts
 * recorded after its last step up to the next step. The engine writes a
 * command's flows before its other facts (the work completed at the node left,
 * the task created at the node entered), so these belong with the step already
 * on screen, not with the next one. Still a prefix of the real facts.
 */
export function trailPrefix<T>(ordered: readonly T[], visibleCount: number, isStep: (fact: T) => boolean): T[] {
  let end = Math.min(visibleCount, ordered.length);
  while (end < ordered.length && !isStep(ordered[end])) end += 1;
  return ordered.slice(0, end);
}

/**
 * Paced playback of a live instance (M5 S3): the canvas follows the instance
 * one flow at a time. While the playback is behind, the frame is where the
 * tokens were at the replayed moment (never ahead of it); caught up, it is
 * the real state.
 */
export function useInstancePlayback(
  workflow: WorkflowFile | null | undefined,
  instance: ProcessInstanceDTO | null | undefined,
  activities: ActivityInstanceDTO[],
  history: ActivityHistoryDTO[],
  incidentNodeIds: string[] = [],
  options: { fromStart?: boolean } = {},
): Omit<PacedPlayback<ActivityHistoryDTO>, 'visible'> & { frame: InstanceFrame | null; trail: ActivityHistoryDTO[] } {
  const me = getUserFromToken(keycloak.tokenParsed)?.username;
  const isUrgent = useMemo(() => urgentHistoryFact(me), [me]);
  const order = useMemo(() => playbackOrder(history), [history]);
  const sameStep = useCallback((previous: ActivityHistoryDTO, next: ActivityHistoryDTO) => {
    const key = order.stepKeyOf.get(previous.id);
    return !!key && key === order.stepKeyOf.get(next.id);
  }, [order]);
  // A retry is watched phase by phase (M5 S4): each of its facts is a step, seen even when the instance ends right after.
  const retryFacts = useMemo(() => retryFactIds(order.ordered), [order]);
  const isStep = useCallback((event: ActivityHistoryDTO) => isFlowStep(event) || retryFacts.has(event.id), [retryFacts]);
  const holdsCatchUp = useCallback((event: ActivityHistoryDTO) => retryFacts.has(event.id), [retryFacts]);
  const { visible, lag, jumpToNow, pace, setPace } = usePacedPlayback(order.ordered, {
    id: historyFactId,
    isStep,
    sameStep,
    isUrgent,
    holdsCatchUp,
    urgentKey: urgentStateKey(instance, incidentNodeIds),
    resetKey: instance?.id,
    fromStart: options.fromStart,
  });
  const frame = useMemo<InstanceFrame | null>(() => {
    if (!instance) return null;
    // Caught up: the real state, with the history in playback order so visit numbers do not jump.
    if (!workflow || lag === 0) return { instance, activities, history: order.ordered };
    return { ...instanceAtPrefix(workflow, instance, visible), history: visible };
  }, [workflow, instance, activities, order, visible, lag]);
  const trail = useMemo(
    () => (lag === 0 ? order.ordered : trailPrefix(order.ordered, visible.length, isStep)),
    [lag, order, visible, isStep],
  );
  return { frame, trail, lag, jumpToNow, pace, setPace };
}
