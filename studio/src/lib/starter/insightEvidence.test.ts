import { describe, expect, it, vi } from 'vitest';
import { runSequentialInsightEvidence } from './insightEvidence';

describe('runSequentialInsightEvidence', () => {
  it('waits for each LOW execution before starting the next one', async () => {
    const events: string[] = [];
    const polls = new Map<string, number>();

    const result = await runSequentialInsightEvidence({
      count: 4,
      start: async (index) => {
        const id = `instance-${index + 1}`;
        events.push(`start:${id}`);
        return id;
      },
      get: async (id) => {
        const poll = (polls.get(id) ?? 0) + 1;
        polls.set(id, poll);
        events.push(`poll:${id}:${poll}`);
        return { status: poll === 1 ? 'RUNNING' : 'COMPLETED' };
      },
      wait: vi.fn().mockResolvedValue(undefined),
      pollIntervalMs: 0,
      interRunDelayMs: 0,
    });

    expect(result).toEqual(['instance-1', 'instance-2', 'instance-3', 'instance-4']);
    expect(events).toEqual([
      'start:instance-1', 'poll:instance-1:1', 'poll:instance-1:2',
      'start:instance-2', 'poll:instance-2:1', 'poll:instance-2:2',
      'start:instance-3', 'poll:instance-3:1', 'poll:instance-3:2',
      'start:instance-4', 'poll:instance-4:1', 'poll:instance-4:2',
    ]);
  });

  it('stops immediately when one execution fails', async () => {
    const start = vi.fn(async (index: number) => `instance-${index + 1}`);
    await expect(runSequentialInsightEvidence({
      count: 4,
      start,
      get: async () => ({ status: 'FAILED' }),
      wait: vi.fn().mockResolvedValue(undefined),
      interRunDelayMs: 0,
    })).rejects.toThrow('LOW execution 1 did not complete successfully');
    expect(start).toHaveBeenCalledTimes(1);
  });
});
