import type { WorkflowEdge, WorkflowNode } from '@/types';
import {
  type FlowDirection,
  type Point,
  type Rect,
  type Side,
  sidePoint,
  sizeOf,
} from './nodeGeometry';

/** An orthogonal edge route: the polyline and, when placed by the layout, its label centre. */
export interface EdgeRoute {
  points: Point[];
  label?: Point;
}

/* ------------------------------------------------------------------ */
/* Edge semantics                                                      */
/* ------------------------------------------------------------------ */

/**
 * - `flow`: a sequence flow (`next`, gateway branch, parallel branch).
 * - `default`: the `else` branch of a condition — drawn with the BPMN
 *   default-flow slash.
 * - `outcome-error` / `outcome-warn`: engine outcome routes (`on_error`,
 *   `on_low_confidence`, `on_invalid_output`) leaving from a boundary marker.
 */
export type EdgeKind = 'flow' | 'default' | 'outcome-error' | 'outcome-warn';

/** Outcome routes are the edges the parser labels `on_*`. */
export function edgeKindOf(edge: Pick<WorkflowEdge, 'label'>): EdgeKind {
  const label = edge.label ?? '';
  if (label.startsWith('on_error')) return 'outcome-error';
  if (label.startsWith('on_')) return 'outcome-warn';
  if (label === 'else') return 'default';
  return 'flow';
}

export const isOutcomeKind = (kind: EdgeKind): boolean =>
  kind === 'outcome-error' || kind === 'outcome-warn';

export interface OutcomeSlot { index: number; count: number }

/** Position of each outcome route among its source node's outcome routes. */
export function outcomeSlots(edges: WorkflowEdge[]): Map<string, OutcomeSlot> {
  const bySource = new Map<string, string[]>();
  for (const edge of edges) {
    if (!isOutcomeKind(edgeKindOf(edge))) continue;
    const list = bySource.get(edge.source) ?? [];
    list.push(edge.id);
    bySource.set(edge.source, list);
  }
  const slots = new Map<string, OutcomeSlot>();
  for (const ids of bySource.values()) {
    ids.forEach((id, index) => slots.set(id, { index, count: ids.length }));
  }
  return slots;
}

/**
 * Index of each edge among the edges sharing its source and target, so
 * parallel edges between the same pair get distinct lanes instead of
 * overlapping.
 */
export function parallelLanes(edges: WorkflowEdge[]): Map<string, number> {
  const seen = new Map<string, number>();
  const lanes = new Map<string, number>();
  for (const edge of edges) {
    const key = `${edge.source}\u0000${edge.target}`;
    const lane = seen.get(key) ?? 0;
    lanes.set(edge.id, lane);
    seen.set(key, lane + 1);
  }
  return lanes;
}

/** Human-friendly edge label: `${…}` expression wrappers dropped, long text truncated. */
export const EDGE_LABEL_MAX_CHARS = 32;

export function cleanEdgeLabel(label: string | undefined): string {
  if (!label) return '';
  const text = label
    .replace(/\$\{\s*([^}]*?)\s*\}/g, '$1')
    .replace(/^on_low_confidence$/, 'low confidence')
    .replace(/^on_invalid_output$/, 'invalid output')
    .replace(/^on_timeout$/, 'timeout')
    .replace(/^outcome: /, '')
    .replace(/^on_error(: )?/, (_, code) => (code ? 'error ' : 'error'))
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

export function truncateLabel(text: string, max = EDGE_LABEL_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Rough label box used to reserve space in the layout. */
export function estimateLabelSize(text: string): { width: number; height: number } {
  return { width: Math.round(text.length * 6 + 18), height: 18 };
}

/* ------------------------------------------------------------------ */
/* Direction inference                                                 */
/* ------------------------------------------------------------------ */

/**
 * Flow axis of an existing arrangement (saved `ui` positions, or a manual
 * layout), from the displacement of its sequence flows.
 */
export function inferDirection(nodes: WorkflowNode[], edges: WorkflowEdge[]): FlowDirection {
  const centers = new Map(nodes.map((node) => {
    const size = sizeOf(node);
    return [node.id, { x: node.x + size.width / 2, y: node.y + size.height / 2 }];
  }));
  let dx = 0;
  let dy = 0;
  for (const edge of edges) {
    if (isOutcomeKind(edgeKindOf(edge))) continue;
    const a = centers.get(edge.source);
    const b = centers.get(edge.target);
    if (!a || !b) continue;
    dx += Math.abs(b.x - a.x);
    dy += Math.abs(b.y - a.y);
  }
  return dy > dx * 1.2 ? 'vertical' : 'horizontal';
}

/* ------------------------------------------------------------------ */
/* Fallback orthogonal router                                          */
/* ------------------------------------------------------------------ */

const CLEARANCE = 24;
const LANE_GAP = 10;

/** Transposes horizontal-frame geometry into the vertical frame (and back). */
const tp = (p: Point): Point => ({ x: p.y, y: p.x });
const tr = (r: Rect): Rect => ({ x: r.y, y: r.x, width: r.height, height: r.width });

function absSide(rect: Rect, side: Side): Point {
  const local = sidePoint(rect, side);
  return { x: rect.x + local.x, y: rect.y + local.y };
}

export interface RouteRequest {
  source: Rect;
  target: Rect;
  kind: EdgeKind;
  direction: FlowDirection;
  /** Absolute start point of an outcome route (its boundary marker). */
  outcomeStart?: Point;
  /** Lane among parallel edges between the same nodes. */
  lane?: number;
}

/**
 * Orthogonal route for an edge whose nodes were moved since the last
 * auto-layout (or were never auto-laid-out). Computed in the horizontal frame;
 * vertical diagrams are transposed in and out.
 *
 * - forward flows leave the flow-out side and enter the flow-in side;
 * - back edges (loops) leave from below and re-enter from below, a U-shape
 *   under both nodes so they never cut through the diagram;
 * - outcome routes drop from their boundary marker.
 */
export function routeFallback(req: RouteRequest): Point[] {
  const vertical = req.direction === 'vertical';
  const s = vertical ? tr(req.source) : req.source;
  const t = vertical ? tr(req.target) : req.target;
  const lane = req.lane ?? 0;
  const start = req.outcomeStart ? (vertical ? tp(req.outcomeStart) : req.outcomeStart) : undefined;

  const points = start
    ? routeOutcomeH(start, s, t, lane)
    : routeFlowH(s, t, lane);
  return simplify(vertical ? points.map(tp) : points);
}

function routeFlowH(s: Rect, t: Rect, lane: number): Point[] {
  const sOut = absSide(s, 'right');
  const tIn = absSide(t, 'left');
  if (t.x >= s.x + s.width + CLEARANCE) {
    if (Math.abs(sOut.y - tIn.y) < 1 && lane === 0) return [sOut, tIn];
    const midX = (sOut.x + tIn.x) / 2 + lane * LANE_GAP;
    return [sOut, { x: midX, y: sOut.y }, { x: midX, y: tIn.y }, tIn];
  }
  if (t.y >= s.y + s.height + CLEARANCE) {
    const a = absSide(s, 'bottom');
    const b = absSide(t, 'top');
    const midY = (a.y + b.y) / 2 + lane * LANE_GAP;
    return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
  }
  if (t.y + t.height <= s.y - CLEARANCE) {
    const a = absSide(s, 'top');
    const b = absSide(t, 'bottom');
    const midY = (a.y + b.y) / 2 - lane * LANE_GAP;
    return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
  }
  // Back edge or overlapping nodes: loop underneath both.
  const a = absSide(s, 'bottom');
  const b = absSide(t, 'bottom');
  const low = Math.max(s.y + s.height, t.y + t.height) + CLEARANCE * 1.5 + lane * LANE_GAP;
  return [a, { x: a.x, y: low }, { x: b.x, y: low }, b];
}

function routeOutcomeH(start: Point, s: Rect, t: Rect, lane: number): Point[] {
  const tIn = absSide(t, 'left');
  if (tIn.x >= start.x + CLEARANCE && tIn.y >= start.y + CLEARANCE / 2) {
    return [start, { x: start.x, y: tIn.y }, tIn];
  }
  if (t.y >= start.y + CLEARANCE) {
    const b = absSide(t, 'top');
    const midY = (start.y + b.y) / 2 + lane * LANE_GAP;
    return [start, { x: start.x, y: midY }, { x: b.x, y: midY }, b];
  }
  const b = absSide(t, 'bottom');
  const low = Math.max(start.y, s.y + s.height, t.y + t.height) + CLEARANCE * 1.5 + lane * LANE_GAP;
  return [start, { x: start.x, y: low }, { x: b.x, y: low }, b];
}

/** Drops repeated and collinear points so corners are only drawn where the route turns. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const collinear = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5)
        || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);
      if (!collinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Path and label geometry                                             */
/* ------------------------------------------------------------------ */

const fmt = (n: number) => Math.round(n * 10) / 10;

/** SVG path through `points` with rounded corners of at most `radius`. */
export function roundedPath(points: Point[], radius = 8): string {
  if (points.length === 0) return '';
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += ` L ${fmt(corner.x)} ${fmt(corner.y)}`;
      continue;
    }
    const a = { x: corner.x - ((corner.x - prev.x) / inLen) * r, y: corner.y - ((corner.y - prev.y) / inLen) * r };
    const b = { x: corner.x + ((next.x - corner.x) / outLen) * r, y: corner.y + ((next.y - corner.y) / outLen) * r };
    d += ` L ${fmt(a.x)} ${fmt(a.y)} Q ${fmt(corner.x)} ${fmt(corner.y)} ${fmt(b.x)} ${fmt(b.y)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}

/**
 * Anchor for an edge label: the middle of the route's last segment along the
 * flow axis. For a fork that is the segment unique to the branch, so each
 * condition sits visibly on its own branch rather than on the shared trunk.
 */
export function labelAnchor(points: Point[], direction: FlowDirection): Point {
  if (points.length === 1) return points[0];
  const alongFlow = (a: Point, b: Point) => (direction === 'vertical'
    ? Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 1
    : Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 1);
  for (let i = points.length - 1; i > 0; i--) {
    if (alongFlow(points[i - 1], points[i])) return midpoint(points[i - 1], points[i]);
  }
  let best = 1;
  let bestLen = -1;
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  return midpoint(points[best - 1], points[best]);
}

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * BPMN default-flow marker: a short slash across the first segment, just
 * after the source. Returns the slash as an SVG path.
 */
export function defaultFlowSlash(points: Point[]): string {
  if (points.length < 2) return '';
  const [a, b] = points;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return '';
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const at = Math.min(12, len / 2);
  const p = { x: a.x + d.x * at, y: a.y + d.y * at };
  // 45° to the flow: blend the direction with its normal.
  const v = { x: (d.x - d.y) * Math.SQRT1_2, y: (d.y + d.x) * Math.SQRT1_2 };
  const h = 6;
  return `M ${fmt(p.x - v.x * h)} ${fmt(p.y - v.y * h)} L ${fmt(p.x + v.x * h)} ${fmt(p.y + v.y * h)}`;
}
