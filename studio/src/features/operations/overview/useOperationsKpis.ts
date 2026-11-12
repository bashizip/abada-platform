import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineAPI, ProcessInstanceDTO } from '@/api/engine';
import type { InstanceStatus } from '@/lib/run/instanceFormat';
import {
  DAY_MS, agentCost, completedInWindow, countPerHour, p95Duration, p95PerHour, runningPerHour,
} from '@/lib/run/kpiBuckets';

/** The 24 h sample: newest first, 100 a page, at most 1 000 instances. */
export const SAMPLE_PAGE = 100;
export const SAMPLE_MAX_PAGES = 10;
/** The sample is heavy (up to ten requests): refreshed once a minute. */
export const SAMPLE_REFRESH_MS = 60_000;
/** Counts are light; live updates refresh them at most this often. */
export const COUNTS_MIN_INTERVAL_MS = 5_000;

const STATES: InstanceStatus[] = ['RUNNING', 'SUSPENDED', 'FAILED', 'COMPLETED', 'CANCELLED'];

export type StateCounts = Partial<Record<'ALL' | InstanceStatus, number>>;

export interface OperationsKpis {
  loaded: boolean;
  running: number;
  runningSeries: number[];
  completed: number;
  completedSeries: number[];
  /** The sample hit its 1 000-instance bound: counts are a floor. */
  capped: boolean;
  waitingOnYou: number;
  waitingSeries: number[];
  p95Ms: number | null;
  p95Series: (number | null)[];
  costUsd: number;
  costIncludesUnpriced: boolean;
  costSeries: number[];
  stateCounts: StateCounts;
}

const EMPTY: OperationsKpis = {
  loaded: false, running: 0, runningSeries: [], completed: 0, completedSeries: [], capped: false,
  waitingOnYou: 0, waitingSeries: [], p95Ms: null, p95Series: [], costUsd: 0, costIncludesUnpriced: false,
  costSeries: [], stateCounts: {},
};

/** Instances started in the last 24 h, plus whether the bound cut it short. */
async function loadSample(projectId: string, now: number): Promise<{ items: ProcessInstanceDTO[]; capped: boolean }> {
  const items: ProcessInstanceDTO[] = [];
  for (let page = 0; page < SAMPLE_MAX_PAGES; page += 1) {
    const result = await EngineAPI.getInstances(projectId, { page, size: SAMPLE_PAGE });
    items.push(...result.items);
    const oldest = result.items.at(-1);
    const more = items.length < result.total;
    if (!oldest || !more || now - new Date(oldest.startDate).getTime() >= DAY_MS) {
      return { items: items.filter((item) => now - new Date(item.startDate).getTime() < DAY_MS), capped: false };
    }
  }
  return { items, capped: true };
}

/**
 * The Operations header KPIs (M5 S6), from the existing `/api/v1` lists only.
 * `liveTick` changes on every project stream event; counts follow it (at most
 * every 5 s), the 24 h sample refreshes every minute.
 */
export function useOperationsKpis(projectId: string | undefined, liveTick: number): OperationsKpis {
  const [kpis, setKpis] = useState<OperationsKpis>(EMPTY);
  const lastCounts = useRef(0);
  /** Responses for a project the user has left are dropped. */
  const current = useRef(projectId);
  useEffect(() => { current.current = projectId; }, [projectId]);

  const loadCounts = useCallback(async (project: string) => {
    lastCounts.current = Date.now();
    const [all, waiting, ...states] = await Promise.all([
      EngineAPI.getInstances(project, { size: 1 }),
      EngineAPI.getTaskPage(project, 'AVAILABLE').catch(() => null),
      ...STATES.map((status) => EngineAPI.getInstances(project, { status, size: 1 })),
    ]);
    const stateCounts: StateCounts = { ALL: all.total };
    STATES.forEach((status, index) => { stateCounts[status] = states[index].total; });
    const now = Date.now();
    if (current.current !== project) return;
    setKpis((previous) => ({
      ...previous,
      running: stateCounts.RUNNING ?? 0,
      stateCounts,
      waitingOnYou: waiting?.total ?? 0,
      waitingSeries: waiting ? countPerHour(waiting.items.map((task) => task.startDate), now) : [],
    }));
  }, []);

  const loadSeries = useCallback(async (project: string) => {
    const now = Date.now();
    const [sample, recentCompleted] = await Promise.all([
      loadSample(project, now),
      EngineAPI.getInstances(project, { status: 'COMPLETED', size: SAMPLE_PAGE }),
    ]);
    const completed = completedInWindow(sample.items, now);
    const cost = agentCost(sample.items, now);
    if (current.current !== project) return;
    setKpis((previous) => ({
      ...previous,
      loaded: true,
      runningSeries: runningPerHour(sample.items, now),
      completed: completed.length,
      completedSeries: countPerHour(completed.map((item) => item.endDate), now),
      capped: sample.capped,
      p95Ms: p95Duration(recentCompleted.items),
      p95Series: p95PerHour(recentCompleted.items, now),
      costUsd: cost.usd,
      costIncludesUnpriced: cost.includesUnpriced,
      costSeries: cost.series,
    }));
  }, []);

  useEffect(() => {
    setKpis(EMPTY);
    if (!projectId) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void Promise.all([loadCounts(projectId), loadSeries(projectId)])
        .catch(() => undefined)
        .finally(() => { if (!cancelled) setKpis((previous) => ({ ...previous, loaded: true })); });
    };
    run();
    const timer = window.setInterval(() => { void loadSeries(projectId).catch(() => undefined); }, SAMPLE_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, loadCounts, loadSeries]);

  useEffect(() => {
    if (!projectId || liveTick === 0) return;
    const wait = Math.max(0, lastCounts.current + COUNTS_MIN_INTERVAL_MS - Date.now());
    const timer = window.setTimeout(() => { void loadCounts(projectId).catch(() => undefined); }, wait);
    return () => window.clearTimeout(timer);
  }, [projectId, liveTick, loadCounts]);

  return kpis;
}
