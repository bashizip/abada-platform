import { describe, expect, it } from 'vitest';
import {
  cleanEdgeLabel,
  defaultFlowSlash,
  edgeKindOf,
  inferDirection,
  labelAnchor,
  outcomeSlots,
  parallelLanes,
  roundedPath,
  routeFallback,
  simplify,
  truncateLabel,
} from './edgeGeometry';
import type { Point, Rect } from './nodeGeometry';
import type { WorkflowNode } from '@/types';

const rect = (x: number, y: number, width = 216, height = 80): Rect => ({ x, y, width, height });
const axisAligned = (points: Point[]) =>
  points.slice(1).every((p, i) => Math.abs(p.x - points[i].x) < 0.5 || Math.abs(p.y - points[i].y) < 0.5);

describe('edge semantics', () => {
  it('classifies outcome routes, default flows and sequence flows', () => {
    expect(edgeKindOf({ label: 'on_error' })).toBe('outcome-error');
    expect(edgeKindOf({ label: 'on_error: TIMEOUT' })).toBe('outcome-error');
    expect(edgeKindOf({ label: 'on_low_confidence' })).toBe('outcome-warn');
    expect(edgeKindOf({ label: 'on_invalid_output' })).toBe('outcome-warn');
    expect(edgeKindOf({ label: 'else' })).toBe('default');
    expect(edgeKindOf({ label: 'if ${x > 1}' })).toBe('flow');
    expect(edgeKindOf({})).toBe('flow');
  });

  it('numbers outcome routes per source and parallel edges per node pair', () => {
    const edges = [
      { id: 'a', source: 'n', target: 'x' },
      { id: 'b', source: 'n', target: 'y', label: 'on_error' },
      { id: 'c', source: 'n', target: 'y', label: 'on_low_confidence' },
    ];
    expect(outcomeSlots(edges).get('b')).toEqual({ index: 0, count: 2 });
    expect(outcomeSlots(edges).get('c')).toEqual({ index: 1, count: 2 });
    expect(outcomeSlots(edges).has('a')).toBe(false);
    expect(parallelLanes(edges).get('b')).toBe(0);
    expect(parallelLanes(edges).get('c')).toBe(1);
  });

  it('cleans and truncates labels for the canvas', () => {
    expect(cleanEdgeLabel("if ${route == 'HIGH'}")).toBe("if route == 'HIGH'");
    expect(cleanEdgeLabel('on_low_confidence')).toBe('low confidence');
    expect(cleanEdgeLabel('on_timeout')).toBe('timeout');
    expect(cleanEdgeLabel('outcome: reject')).toBe('reject');
    expect(cleanEdgeLabel('on_exhausted')).toBe('limit reached');
    expect(cleanEdgeLabel('on_error: CANNOT_DECIDE')).toBe('error CANNOT_DECIDE');
    expect(cleanEdgeLabel('on_error')).toBe('error');
    expect(cleanEdgeLabel(undefined)).toBe('');
    const long = truncateLabel('if lead_priority.priority == "HIGH" && region == "EU"');
    expect(long.length).toBe(32);
    expect(long.endsWith('…')).toBe(true);
    expect(truncateLabel('else')).toBe('else');
  });

  it('infers the flow direction of an existing arrangement', () => {
    const node = (id: string, x: number, y: number) => ({ id, type: 'agent', x, y } as WorkflowNode);
    const edges = [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'c' }];
    expect(inferDirection([node('a', 0, 0), node('b', 300, 0), node('c', 600, 20)], edges)).toBe('horizontal');
    expect(inferDirection([node('a', 0, 0), node('b', 0, 200), node('c', 10, 400)], edges)).toBe('vertical');
  });
});

describe('fallback router', () => {
  it('draws a straight line between aligned nodes', () => {
    const points = routeFallback({ source: rect(0, 0), target: rect(300, 0), kind: 'flow', direction: 'horizontal' });
    expect(points).toEqual([{ x: 216, y: 40 }, { x: 300, y: 40 }]);
  });

  it('steps orthogonally between offset nodes', () => {
    const points = routeFallback({ source: rect(0, 0), target: rect(300, 200), kind: 'flow', direction: 'horizontal' });
    expect(points[0]).toEqual({ x: 216, y: 40 });
    expect(points[points.length - 1]).toEqual({ x: 300, y: 240 });
    expect(axisAligned(points)).toBe(true);
  });

  it('routes a loop underneath both nodes, leaving and entering from below', () => {
    const points = routeFallback({ source: rect(600, 0), target: rect(0, 0), kind: 'flow', direction: 'horizontal' });
    expect(points[0]).toEqual({ x: 708, y: 80 });
    expect(points[points.length - 1]).toEqual({ x: 108, y: 80 });
    expect(Math.max(...points.map((p) => p.y))).toBeGreaterThan(80);
    expect(axisAligned(points)).toBe(true);
  });

  it('transposes for vertical flows', () => {
    const points = routeFallback({ source: rect(0, 0), target: rect(0, 200), kind: 'flow', direction: 'vertical' });
    expect(points).toEqual([{ x: 108, y: 80 }, { x: 108, y: 200 }]);
  });

  it('drops outcome routes from their boundary marker', () => {
    const points = routeFallback({
      source: rect(0, 0), target: rect(300, 200), kind: 'outcome-error', direction: 'horizontal',
      outcomeStart: { x: 150, y: 80 },
    });
    expect(points).toEqual([{ x: 150, y: 80 }, { x: 150, y: 240 }, { x: 300, y: 240 }]);
  });

  it('separates parallel edges into lanes', () => {
    const a = routeFallback({ source: rect(0, 0), target: rect(300, 200), kind: 'flow', direction: 'horizontal', lane: 0 });
    const b = routeFallback({ source: rect(0, 0), target: rect(300, 200), kind: 'flow', direction: 'horizontal', lane: 1 });
    expect(a[1].x).not.toBe(b[1].x);
  });

  it('removes repeated and collinear points', () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }]))
      .toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }]);
  });
});

describe('path and label geometry', () => {
  it('rounds corners without overshooting short segments', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe('M 0 0 L 100 0');
    expect(roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]))
      .toBe('M 0 0 L 92 0 Q 100 0 100 8 L 100 100');
    expect(roundedPath([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 100 }]))
      .toBe('M 0 0 L 3 0 Q 6 0 6 3 L 6 100');
  });

  it('anchors a branch label on the segment unique to the branch', () => {
    const fork = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 100 }, { x: 200, y: 100 }];
    expect(labelAnchor(fork, 'horizontal')).toEqual({ x: 120, y: 100 });
    expect(labelAnchor([{ x: 0, y: 0 }, { x: 0, y: 80 }], 'vertical')).toEqual({ x: 0, y: 40 });
  });

  it('draws the default-flow slash across the first segment near the source', () => {
    const slash = defaultFlowSlash([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const [, x1, y1, , x2, y2] = slash.split(' ').map(Number);
    expect((x1 + x2) / 2).toBeCloseTo(12, 0);
    expect(Math.sign(y1)).not.toBe(Math.sign(y2));
  });
});
