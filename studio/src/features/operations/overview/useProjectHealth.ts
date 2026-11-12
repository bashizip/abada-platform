import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineAPI, IncidentDTO, WorkerHealthDTO } from '@/api/engine';

/** Polls `load` every `pollMs` and again whenever `liveTick` changes; the newest response wins. */
function usePolled<T>(projectId: string | undefined, load: (project: string) => Promise<T>, empty: T,
  pollMs: number, liveTick: number) {
  const [data, setData] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const mine = ++seq.current;
    try {
      const next = await load(projectId);
      if (mine !== seq.current) return;
      setData(next);
      setError(null);
    } catch (cause) {
      if (mine === seq.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [projectId, load]);

  useEffect(() => {
    setData(empty);
    setLoading(Boolean(projectId));
    if (!projectId) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, pollMs);
    return () => window.clearInterval(timer);
    // `empty` is a constant per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refresh, pollMs]);

  useEffect(() => {
    if (liveTick > 0) void refresh();
  }, [liveTick, refresh]);

  return { data, loading, error, refresh };
}

const NO_INCIDENTS: IncidentDTO[] = [];
const NO_WORKERS: WorkerHealthDTO[] = [];
const loadIncidents = (project: string) => EngineAPI.getIncidents(project);
const loadWorkers = (project: string) => EngineAPI.getWorkerHealth(project);

/** The project's open incidents (at most 100, as the engine lists them), refreshed with the stream. */
export function useProjectIncidents(projectId: string | undefined, liveTick: number) {
  const { data, loading, error, refresh } = usePolled(projectId, loadIncidents, NO_INCIDENTS, 15_000, liveTick);
  return { incidents: data, loading, error, refresh };
}

/** Liveness of the workers bound to the project (heartbeats, not stream events: polled). */
export function useWorkerHealth(projectId: string | undefined) {
  const { data, loading, error } = usePolled(projectId, loadWorkers, NO_WORKERS, 5_000, 0);
  return { workers: data, loading, error };
}
