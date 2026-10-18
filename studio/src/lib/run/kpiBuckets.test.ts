import { describe, expect, it } from 'vitest';
import type { ProcessInstanceDTO } from '@/api/engine';
import {
  HOUR_MS, agentCost, bucketOf, completedInWindow, countPerHour, p95Duration, p95PerHour, percentile, runningPerHour,
} from './kpiBuckets';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR_MS).toISOString();
const instance = (patch: Partial<ProcessInstanceDTO>): ProcessInstanceDTO => ({
  id: Math.random().toString(36).slice(2), processDefinitionId: 'p', status: 'RUNNING', startDate: at(1), ...patch,
} as ProcessInstanceDTO);

describe('KPI buckets', () => {
  it('puts the last hour in the last bucket and ignores anything older than 24 h or in the future', () => {
    expect(bucketOf(NOW - 10, NOW)).toBe(23);
    expect(bucketOf(NOW - 23.5 * HOUR_MS, NOW)).toBe(0);
    expect(bucketOf(NOW - 24 * HOUR_MS, NOW)).toBe(-1);
    expect(bucketOf(NOW + 1000, NOW)).toBe(-1);
    expect(countPerHour([at(0.2), at(0.4), at(5.5), null, 'not a date'], NOW)).toEqual(
      Array.from({ length: 24 }, (_, index) => (index === 23 ? 2 : index === 18 ? 1 : 0)));
  });

  it('counts the instances running at the end of each hour', () => {
    const series = runningPerHour([
      instance({ startDate: at(3) }),
      instance({ startDate: at(5), endDate: at(2), status: 'COMPLETED' }),
    ], NOW);
    expect(series[23]).toBe(1);
    expect(series[21]).toBe(1); // 2 h ago: the second has just ended
    expect(series[20]).toBe(2); // 3 h ago: both were running
    expect(series[18]).toBe(1); // 5 h ago: only the second had started
    expect(series[17]).toBe(0);
  });

  it('takes the nearest-rank percentile and the p95 of completed durations', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    const durations = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(percentile(durations, 0.95)).toBe(19);
    const done = durations.map((minutes) => instance({
      status: 'COMPLETED', startDate: new Date(NOW - HOUR_MS / 2 - minutes * 60_000).toISOString(), endDate: at(0.5),
    }));
    expect(p95Duration(done)).toBe(19 * 60_000);
  });

  it('leaves an hourly duration point empty below five samples', () => {
    const done = (count: number, hoursAgo: number) => Array.from({ length: count }, () => instance({
      status: 'COMPLETED', startDate: at(hoursAgo + 0.1), endDate: at(hoursAgo),
    }));
    const series = p95PerHour([...done(5, 0.5), ...done(4, 2.5)], NOW);
    expect(series[23]).toBe(0.1 * HOUR_MS);
    expect(series[21]).toBeNull();
  });

  it('sums the priced agent cost and flags unpriced calls', () => {
    const cost = agentCost([
      instance({ agentCost: { usd: 1.25, promptTokens: 1, completionTokens: 1, includesUnpriced: false } }),
      instance({ startDate: at(3), agentCost: { promptTokens: 1, completionTokens: 1, includesUnpriced: true } }),
      instance({}),
    ], NOW);
    expect(cost.usd).toBe(1.25);
    expect(cost.includesUnpriced).toBe(true);
    expect(cost.series[22]).toBe(1.25);
  });

  it('keeps only the instances that completed in the last 24 h', () => {
    const kept = completedInWindow([
      instance({ status: 'COMPLETED', endDate: at(2) }),
      instance({ status: 'COMPLETED', endDate: at(30) }),
      instance({ status: 'FAILED', endDate: at(1) }),
    ], NOW);
    expect(kept).toHaveLength(1);
  });
});
