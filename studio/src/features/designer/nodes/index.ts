import type { NodeTypes } from '@xyflow/react';
import type { WorkflowEdge, WorkflowNode } from '@/types';
import { shapeOf, sizeOf } from '@/lib/layout/nodeGeometry';
import { edgeKindOf, isOutcomeKind, type EdgeKind } from '@/lib/layout/edgeGeometry';
import { EventNode } from './EventNode';
import { GatewayNode } from './GatewayNode';
import { TaskNode } from './TaskNode';
import type { CanvasNode, CanvasNodeData } from './nodeState';

export type { CanvasNode, CanvasNodeData } from './nodeState';

/** React Flow node type per shape. */
export const canvasNodeTypes: NodeTypes = {
  event: EventNode,
  gateway: GatewayNode,
  task: TaskNode,
};

/** Kinds of each node's outcome routes, in the order their boundary markers are drawn. */
export function outcomeKindsBySource(edges: WorkflowEdge[]): Map<string, EdgeKind[]> {
  const kinds = new Map<string, EdgeKind[]>();
  for (const edge of edges) {
    const kind = edgeKindOf(edge);
    if (!isOutcomeKind(kind)) continue;
    kinds.set(edge.source, [...(kinds.get(edge.source) ?? []), kind]);
  }
  return kinds;
}

export function toCanvasNode(
  node: WorkflowNode,
  extra: Partial<CanvasNodeData> & { selected?: boolean; selectable?: boolean } = {},
): CanvasNode {
  const { selected, selectable, ...data } = extra;
  // Shapes have a fixed size: declaring it lets React Flow (fit view, minimap)
  // know the geometry before and without DOM measurement.
  const { width, height } = sizeOf(node);
  return {
    id: node.id,
    type: shapeOf(node),
    position: { x: node.x, y: node.y },
    width,
    height,
    data: { ...node, ...data } as CanvasNodeData,
    ...(selected !== undefined ? { selected } : {}),
    ...(selectable !== undefined ? { selectable } : {}),
  };
}
