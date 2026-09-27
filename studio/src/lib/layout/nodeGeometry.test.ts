import { describe, expect, it } from 'vitest';
import {
  EVENT_SIZE,
  GATEWAY_SIZE,
  TASK_HEIGHT,
  TASK_WIDTH,
  outcomePortPoint,
  outsideLabelSize,
  shapeOf,
  sidePoint,
  sizeOf,
} from './nodeGeometry';
import type { NodeType } from '@/types';

describe('node geometry', () => {
  it('maps node types to BPMN shapes with fixed sizes', () => {
    const cases: [NodeType, string, number, number][] = [
      ['event', 'event', EVENT_SIZE, EVENT_SIZE],
      ['gateway', 'gateway', GATEWAY_SIZE, GATEWAY_SIZE],
      ['agent', 'task', TASK_WIDTH, TASK_HEIGHT],
      ['human', 'task', TASK_WIDTH, TASK_HEIGHT],
      ['dmn', 'task', TASK_WIDTH, TASK_HEIGHT],
      ['engine-task', 'task', TASK_WIDTH, TASK_HEIGHT],
      ['script', 'task', TASK_WIDTH, TASK_HEIGHT],
    ];
    for (const [type, shape, width, height] of cases) {
      expect(shapeOf({ type })).toBe(shape);
      expect(sizeOf({ type })).toEqual({ width, height });
    }
  });

  it('puts ports on the side midpoints (diamond tips, circle extremes)', () => {
    const size = { width: GATEWAY_SIZE, height: GATEWAY_SIZE };
    expect(sidePoint(size, 'left')).toEqual({ x: 0, y: 26 });
    expect(sidePoint(size, 'right')).toEqual({ x: 52, y: 26 });
    expect(sidePoint(size, 'top')).toEqual({ x: 26, y: 0 });
    expect(sidePoint(size, 'bottom')).toEqual({ x: 26, y: 52 });
  });

  it('spreads outcome markers along the outcome side, clear of the title', () => {
    const size = { width: TASK_WIDTH, height: TASK_HEIGHT };
    const a = outcomePortPoint(size, 'horizontal', 0, 2);
    const b = outcomePortPoint(size, 'horizontal', 1, 2);
    expect(a.y).toBe(TASK_HEIGHT);
    expect(a.x).toBeGreaterThan(TASK_WIDTH * 0.4);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.x).toBeLessThan(TASK_WIDTH);
    expect(outcomePortPoint(size, 'vertical', 0, 1).x).toBe(TASK_WIDTH);
  });

  it('sizes outside labels for events and gateways only, at most two lines', () => {
    expect(outsideLabelSize({ type: 'agent', title: 'Classify' })).toBeNull();
    expect(outsideLabelSize({ type: 'event', title: '' })).toBeNull();
    expect(outsideLabelSize({ type: 'event', title: 'Start' })!.height).toBe(14);
    expect(outsideLabelSize({ type: 'gateway', title: 'x'.repeat(200) })).toEqual({ width: 140, height: 28 });
  });
});
