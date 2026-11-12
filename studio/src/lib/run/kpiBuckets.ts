import type { ProcessInstanceDTO } from '@/api/engine';

/**
 * The Operations KPI series (M5 S6), computed in the Studio from what the
 * `/api/v1` lists already return: there is no aggregation endpoint, so every
 * series is rebuilt from a bounded sample and says so when the bound is hit.
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** The hourly points of a 24 h sparkline. */
export const SPARK_HOURS = 24;
/** An hourly duration point needs this many samples; fewer leave a gap. */
export const MIN_DURATION_SAMPLES = 5;

const time = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
};

/** Index of the hour bucket `at` falls in, oldest first, or -1 outside the last 24 h. */
export function bucketOf(at: number, now: number, hours = SPARK_HOURS): number {
  const age = now - at;
  if (age < 0 || age >= hours * HOUR_MS) return -1;
  return hours - 1 - Math.floor(age / HOUR_MS);
}

/** How many of `dates` fall in each hour of the last 24 h, oldest first. */
export function countPerHour(dates: readonly (string | null | undefined)[], now: number, hours = SPARK_HOURS): number[] {
  const series = new Array<number>(hours).fill(0);
  for (const iso of dates) {
    const at = time(iso);
    if (at === null) continue;
    const bucket = bucketOf(at, now, hours);
    if (bucket >= 0) series[bucket] += 1;
  }
  return series;
}

/**
 * How many instances were running at the end of each hour, oldest first. Only
 * as complete as the sample: callers pass every instance that started in the
 * window plus the ones still running.
 */
export function runningPerHour(instances: readonly ProcessInstanceDTO[], now: number, hours = SPARK_HOURS): number[] {
  return Array.from({ length: hours }, (_, index) => {
    const at = now - (hours - 1 - index) * HOUR_MS;
    return instances.filter((instance) => {
      const start = time(instance.startDate);
      const end = time(instance.endDate);
      return start !== null && start <= at && (end === null || end > at);
    }).length;
  });
}

/** The `p`-th percentile (0..1) by nearest rank; null without values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

const durationOf = (instance: ProcessInstanceDTO): number | null => {
  const start = time(instance.startDate);
  const end = time(instance.endDate);
  return start === null || end === null || end < start ? null : end - start;
};

/** p95 of the completed instances' durations. */
export function p95Duration(completed: readonly ProcessInstanceDTO[]): number | null {
  return percentile(completed.map(durationOf).filter((ms): ms is number => ms !== null), 0.95);
}

/** p95 duration per hour of completion, null where an hour has fewer than five samples. */
export function p95PerHour(completed: readonly ProcessInstanceDTO[], now: number, hours = SPARK_HOURS): (number | null)[] {
  const buckets: number[][] = Array.from({ length: hours }, () => []);
  for (const instance of completed) {
    const end = time(instance.endDate);
    const ms = durationOf(instance);
    if (end === null || ms === null) continue;
    const bucket = bucketOf(end, now, hours);
    if (bucket >= 0) buckets[bucket].push(ms);
  }
  return buckets.map((values) => (values.length >= MIN_DURATION_SAMPLES ? percentile(values, 0.95) : null));
}

export interface CostSummary {
  usd: number;
  /** Some agent calls had no price: the real cost is higher. */
  includesUnpriced: boolean;
  /** USD per hour of start, oldest first. */
  series: number[];
}

/** Agent cost of the sample, by the hour the instance started. */
export function agentCost(instances: readonly ProcessInstanceDTO[], now: number, hours = SPARK_HOURS): CostSummary {
  const series = new Array<number>(hours).fill(0);
  let usd = 0;
  let includesUnpriced = false;
  for (const instance of instances) {
    const cost = instance.agentCost;
    if (!cost) continue;
    includesUnpriced ||= cost.includesUnpriced;
    const amount = cost.usd ?? 0;
    usd += amount;
    const start = time(instance.startDate);
    const bucket = start === null ? -1 : bucketOf(start, now, hours);
    if (bucket >= 0) series[bucket] += amount;
  }
  return { usd, includesUnpriced, series };
}

/** Instances of the sample that completed, and when. */
export function completedInWindow(instances: readonly ProcessInstanceDTO[], now: number): ProcessInstanceDTO[] {
  return instances.filter((instance) => {
    const end = time(instance.endDate);
    return (instance.status ?? '').toUpperCase() === 'COMPLETED' && end !== null && now - end < DAY_MS;
  });
}
