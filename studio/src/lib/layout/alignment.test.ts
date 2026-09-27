import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/types';
import { alignTo } from './alignment';

const node = (id: string, type: WorkflowNode['type'], x: number, y: number) => ({ id, type, x, y } as WorkflowNode);

describe('drag alignment', () => {
  // A task (216×80, centre y = 140) and an event (44×44) being dragged.
  const nodes = [node('task', 'agent', 0, 100), node('start', 'event', 400, 0)];

  it('snaps centre lines of different shapes together within the tolerance', () => {
    const result = alignTo(nodes, 'start', { x: 400, y: 121 }); // event centre y = 143, task centre y = 140
    expect(result.guideY).toBe(140);
    expect(result.snapped).toEqual({ x: 400, y: 118 });
  });

  it('snaps on both axes independently', () => {
    const result = alignTo(nodes, 'start', { x: 88, y: 300 }); // event centre x = 110, task centre x = 108
    expect(result.guideX).toBe(108);
    expect(result.guideY).toBeUndefined();
    expect(result.snapped).toEqual({ x: 86, y: 300 });
  });

  it('leaves the node where it was dropped when nothing is close', () => {
    expect(alignTo(nodes, 'start', { x: 300, y: 300 })).toEqual({ snapped: { x: 300, y: 300 } });
  });
});
