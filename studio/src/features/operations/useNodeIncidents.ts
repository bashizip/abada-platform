import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityHistoryDTO, ActivityInstanceDTO, IncidentDTO } from '@/api/engine';
import type { WorkflowFile } from '@/types';
import { duration } from '@/lib/motion';
import { isFinalPhase, retryPhase, type RetryPhase } from '@/lib/run/retryPhase';

/** A retry this view watches play out: from the viewer's click, or one that arrived while the view was open. */
interface WatchedRetry {
  nodeId: string;
  incidentId: string;
  /** The `INCIDENT_RETRIED` history row, once fetched. */
  historyId?: string;
}

export interface NodeIncidents {
  /** Nodes drawn in the incident state: open incidents, except where a retry is playing out. */
  incidentNodeIds: string[];
  /** Open incident id per node in the incident state (a new id pulses once). */
  incidentPulses: Record<string, string>;
  /** Phase per node with a retry playing out. */
  retryPhases: Record<string, RetryPhase>;
  /** The newest open incident per node. */
  incidentAt: Record<string, IncidentDTO>;
  focus: { nodeId: string; key: string } | null;
  /** Node whose incident card is open (or whose retry progress shows). */
  cardNodeId: string | null;
  openCard: (nodeId: string) => void;
  closeCard: () => void;
  /** The engine accepted a retry from this view. */
  retried: (incident: IncidentDTO) => void;
}

/**
 * The incident side of an instance view (M5 S4): which nodes show the
 * incident state, when the canvas focuses one, which card is open, and the
 * phases of a retry as the paced playback reveals its facts. Phases come
 * from `visibleHistory` only, so they move at the playback pace and are never
 * ahead of the recorded facts. A finished retry stays visible one more dwell,
 * then the node settles into its path style (or its new incident).
 */
export function useNodeIncidents(options: {
  workflow: WorkflowFile | null;
  incidents: IncidentDTO[];
  /** True once the first incident load answered. */
  incidentsLoaded: boolean;
  /** The facts the canvas shows (the playback prefix). */
  visibleHistory: ActivityHistoryDTO[];
  /** The real history, once loaded: retries already in it at opening are history, not watched. */
  history: ActivityHistoryDTO[];
  historyLoaded: boolean;
  /** Where the tokens are in the shown frame. */
  activities: ActivityInstanceDTO[];
  /** How long a finished retry stays shown. */
  dwellMs: number;
  /** Opened from an incident elsewhere: focus this node and open its card. */
  initialFocusNodeId?: string;
  /** A watched retry completed (once the playback shows it). */
  onResolved?: (nodeId: string, historyId: string | undefined) => void;
}): NodeIncidents {
  const { workflow, incidents, incidentsLoaded, visibleHistory, history, historyLoaded, activities, dwellMs,
    initialFocusNodeId, onResolved } = options;

  const [watched, setWatched] = useState<WatchedRetry[]>([]);
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState<{ nodeId: string; key: string } | null>(null);
  const [cardNodeId, setCardNodeId] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);
  const seenIncidents = useRef<Set<string> | null>(null);
  const focusSeq = useRef(0);
  const resolvedRef = useRef(onResolved);
  useEffect(() => { resolvedRef.current = onResolved; }, [onResolved]);

  const focusNode = useCallback((nodeId: string) => {
    focusSeq.current += 1;
    setFocus({ nodeId, key: `${nodeId}:${focusSeq.current}` });
    setCardNodeId(nodeId);
  }, []);

  /* Retries recorded before the view opened are history; later ones are watched. */
  useEffect(() => {
    if (!historyLoaded) return;
    const retries = history.filter((event) => event.eventType === 'INCIDENT_RETRIED');
    if (!known.current) {
      known.current = new Set(retries.map((event) => event.id));
      return;
    }
    const fresh = retries.filter((event) => !known.current!.has(event.id));
    if (fresh.length === 0) return;
    fresh.forEach((event) => known.current!.add(event.id));
    setWatched((current) => {
      let next = current;
      for (const event of fresh) {
        const incidentId = typeof event.details?.incidentId === 'string' ? event.details.incidentId : '';
        const nodeId = event.activityId ?? '';
        const pending = next.findIndex((item) => !item.historyId && item.incidentId === incidentId);
        next = pending >= 0
          ? next.map((item, index) => (index === pending ? { ...item, historyId: event.id } : item))
          : [...next, { nodeId, incidentId, historyId: event.id }];
      }
      return next;
    });
  }, [history, historyLoaded]);

  const retried = useCallback((incident: IncidentDTO) => {
    setWatched((current) => (current.some((item) => item.incidentId === incident.id) ? current
      : [...current, { nodeId: incident.activityId, incidentId: incident.id }]));
    setCardNodeId(incident.activityId);
  }, []);

  /* Phase of each watched retry in the shown frame; a committed retry not fetched yet is already retrying. */
  const phases = useMemo(() => {
    const result: Record<string, RetryPhase> = {};
    for (const item of watched) {
      if (settled.has(item.incidentId)) continue;
      const node = workflow?.nodes.find((candidate) => candidate.id === item.nodeId);
      const waitsAgain = !!node && (node.type === 'human' || node.type === 'event')
        && activities.some((activity) => activity.activityId === item.nodeId);
      const phase = item.historyId ? retryPhase(visibleHistory, item.historyId, waitsAgain) : undefined;
      result[item.nodeId] = phase ?? 'retrying';
    }
    return result;
  }, [watched, settled, visibleHistory, activities, workflow]);

  /* A finished retry stays one more dwell, then settles; a completed one is announced. */
  const finished = watched.filter((item) => !settled.has(item.incidentId) && isFinalPhase(phases[item.nodeId]));
  const finishedKey = finished.map((item) => `${item.incidentId}:${phases[item.nodeId]}`).join('|');
  useEffect(() => {
    if (finished.length === 0) return undefined;
    finished.filter((item) => phases[item.nodeId] === 'completed')
      .forEach((item) => resolvedRef.current?.(item.nodeId, item.historyId));
    const timer = window.setTimeout(() => {
      setSettled((current) => new Set([...current, ...finished.map((item) => item.incidentId)]));
      setCardNodeId((current) => (finished.some((item) => item.nodeId === current && phases[item.nodeId] === 'completed')
        ? null : current));
    }, Math.max(dwellMs, duration.calm));
    return () => window.clearTimeout(timer);
    // `finished` is represented by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedKey, dwellMs]);

  const incidentAt = useMemo(() => {
    const result: Record<string, IncidentDTO> = {};
    // Newest first: the first one per node wins.
    for (const incident of incidents) if (!result[incident.activityId]) result[incident.activityId] = incident;
    return result;
  }, [incidents]);

  const incidentNodeIds = useMemo(() => Object.keys(incidentAt)
    // While a retry plays out the node shows its phase; a new incident shows once the failure is on screen.
    .filter((nodeId) => !phases[nodeId] || phases[nodeId] === 'failed')
    .sort(), [incidentAt, phases]);

  const incidentPulses = useMemo(() => Object.fromEntries(incidentNodeIds
    .map((nodeId) => [nodeId, incidentAt[nodeId].id])), [incidentNodeIds, incidentAt]);

  /* Focus: the step this view was opened for, then each new incident as it arrives. */
  useEffect(() => {
    if (!incidentsLoaded || !workflow) return;
    if (!seenIncidents.current) {
      seenIncidents.current = new Set(incidents.map((incident) => incident.id));
      const target = initialFocusNodeId ?? incidents[0]?.activityId;
      if (target && workflow.nodes.some((node) => node.id === target)) focusNode(target);
      return;
    }
    const fresh = incidents.filter((incident) => !seenIncidents.current!.has(incident.id));
    fresh.forEach((incident) => seenIncidents.current!.add(incident.id));
    if (fresh.length > 0) focusNode(fresh[0].activityId);
  }, [incidents, incidentsLoaded, workflow, initialFocusNodeId, focusNode]);

  return {
    incidentNodeIds,
    incidentPulses,
    retryPhases: phases,
    incidentAt,
    focus,
    cardNodeId,
    openCard: focusNode,
    closeCard: useCallback(() => setCardNodeId(null), []),
    retried,
  };
}
