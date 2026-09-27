import type { WorkflowNode } from '@/types';

/**
 * Single source of truth for node geometry, shared by the node renderers and
 * the auto-layout. Shapes have a fixed size so the layout engine places
 * exactly what the canvas draws.
 */
export type NodeShape = 'event' | 'gateway' | 'task';

/** Flow axis of a diagram: horizontal flows left → right, vertical top → bottom. */
export type FlowDirection = 'horizontal' | 'vertical';

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export const EVENT_SIZE = 44;
export const GATEWAY_SIZE = 52;
export const TASK_WIDTH = 216;
export const TASK_HEIGHT = 80;

/** Events and gateways carry their title outside the shape. */
export const OUTSIDE_LABEL_MAX_WIDTH = 140;
export const OUTSIDE_LABEL_LINE_HEIGHT = 14;
export const OUTSIDE_LABEL_GAP = 6;
const OUTSIDE_LABEL_CHAR_WIDTH = 6.2;

export function shapeOf(node: Pick<WorkflowNode, 'type'>): NodeShape {
  if (node.type === 'event') return 'event';
  if (node.type === 'gateway') return 'gateway';
  return 'task';
}

export function sizeOfShape(shape: NodeShape): Size {
  switch (shape) {
    case 'event':
      return { width: EVENT_SIZE, height: EVENT_SIZE };
    case 'gateway':
      return { width: GATEWAY_SIZE, height: GATEWAY_SIZE };
    default:
      return { width: TASK_WIDTH, height: TASK_HEIGHT };
  }
}

export function sizeOf(node: Pick<WorkflowNode, 'type'>): Size {
  return sizeOfShape(shapeOf(node));
}

/**
 * Estimated box of an outside label (events and gateways), at most two lines
 * of `OUTSIDE_LABEL_MAX_WIDTH`. Returns null for tasks or empty titles.
 */
export function outsideLabelSize(node: Pick<WorkflowNode, 'type' | 'title'>): Size | null {
  if (shapeOf(node) === 'task' || !node.title) return null;
  const textWidth = node.title.length * OUTSIDE_LABEL_CHAR_WIDTH;
  const lines = Math.min(2, Math.max(1, Math.ceil(textWidth / OUTSIDE_LABEL_MAX_WIDTH)));
  return {
    width: Math.round(Math.min(OUTSIDE_LABEL_MAX_WIDTH, textWidth)),
    height: lines * OUTSIDE_LABEL_LINE_HEIGHT,
  };
}

/**
 * Port on a side of a shape, relative to its top-left corner. Every shape's
 * ports sit at the midpoints of its bounding box sides — for a diamond these
 * are its tips, for a circle its extremes — so edges end on the outline.
 */
export function sidePoint(size: Size, side: Side): Point {
  switch (side) {
    case 'left':
      return { x: 0, y: size.height / 2 };
    case 'right':
      return { x: size.width, y: size.height / 2 };
    case 'top':
      return { x: size.width / 2, y: 0 };
    default:
      return { x: size.width / 2, y: size.height };
  }
}

/** Side a normal flow enters and leaves a node for the given direction. */
export function flowSides(direction: FlowDirection): { in: Side; out: Side } {
  return direction === 'vertical' ? { in: 'top', out: 'bottom' } : { in: 'left', out: 'right' };
}

/** Side outcome routes (`on_error`, `on_low_confidence`, …) leave a node from. */
export function outcomeSide(direction: FlowDirection): Side {
  return direction === 'vertical' ? 'right' : 'bottom';
}

/**
 * Boundary position of outcome route `index` of `count` on a task's outcome
 * side, relative to the task's top-left corner. Markers are spread along the
 * trailing part of the side so they never collide with the main flow ports.
 */
export function outcomePortPoint(size: Size, direction: FlowDirection, index: number, count: number): Point {
  const side = outcomeSide(direction);
  const span = side === 'bottom' ? size.width : size.height;
  // Spread over the last 60% of the side: the first part stays clear for the title/icon.
  const start = span * 0.4;
  const step = (span - start) / (count + 1);
  const along = start + step * (index + 1);
  return side === 'bottom' ? { x: along, y: size.height } : { x: size.width, y: along };
}
