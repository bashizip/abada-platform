import { describe, expect, it } from 'vitest';
import { bySeverity, incidentSeverity } from './incidentSeverity';

describe('incident severity', () => {
  it('ranks by what it takes to unblock the run', () => {
    expect(incidentSeverity('TOOL_OUTCOME_UNKNOWN')).toBe('decision');
    expect(incidentSeverity('WORK_FAILED')).toBe('blocked');
    expect(incidentSeverity('CHILD_FAILED')).toBe('blocked');
    expect(incidentSeverity('LOOP_EXHAUSTED')).toBe('waiting');
    expect(incidentSeverity('MISSING_CORRELATION_KEY')).toBe('waiting');
    expect(incidentSeverity('SOMETHING_NEW')).toBe('waiting');
  });

  it('sorts the most severe first, then the newest', () => {
    const sorted = bySeverity([
      { id: 'a', type: 'LOOP_EXHAUSTED', createdAt: '2026-10-18T10:00:00Z' },
      { id: 'b', type: 'WORK_FAILED', createdAt: '2026-10-18T09:00:00Z' },
      { id: 'c', type: 'WORK_FAILED', createdAt: '2026-10-18T11:00:00Z' },
      { id: 'd', type: 'TOOL_OUTCOME_UNKNOWN', createdAt: '2026-10-18T08:00:00Z' },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['d', 'c', 'b', 'a']);
  });
});
