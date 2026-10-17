import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineAPI, type IncidentDTO } from '@/api/engine';

export interface InstanceIncidents {
  /** Open incidents of the instance, newest first; empty until the first load. */
  incidents: IncidentDTO[];
  error: string | null;
  loading: boolean;
  /** Reloads now: on each stream event of the instance and after an action. */
  refresh: () => void;
  /** Drops an incident at once (an action resolved it); the next load confirms. */
  drop: (incidentId: string) => void;
}

/**
 * Open incidents of one instance (M5 S4). The instance view refreshes them
 * with its stream events, so an incident reaches the diagram as soon as the
 * stream reports the command that opened it; `pollMs` is the fallback.
 */
export function useInstanceIncidents(projectId: string | undefined, instanceId: string, pollMs: number): InstanceIncidents {
  const [incidents, setIncidents] = useState<IncidentDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    if (!projectId) return;
    const current = ++seq.current;
    EngineAPI.getIncidents(projectId, true, instanceId)
      // The engine narrows the list; the filter keeps an older engine (no instance filter) correct.
      .then((all) => {
        if (current !== seq.current) return;
        const mine = all.filter((incident) => incident.processInstanceId === instanceId);
        setIncidents((previous) => (sameIncidents(previous, mine) ? previous : mine));
        setError(null);
      })
      .catch((cause) => { if (current === seq.current) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (current === seq.current) setLoading(false); });
  }, [projectId, instanceId]);

  useEffect(() => {
    refresh();
    if (!pollMs) return undefined;
    const timer = window.setInterval(refresh, pollMs);
    return () => window.clearInterval(timer);
  }, [refresh, pollMs]);

  const drop = useCallback((incidentId: string) => {
    setIncidents((current) => current.filter((incident) => incident.id !== incidentId));
  }, []);

  return { incidents, error, loading, refresh, drop };
}

const sameIncidents = (a: IncidentDTO[], b: IncidentDTO[]) =>
  a.length === b.length && a.every((incident, index) => incident.id === b[index].id);
