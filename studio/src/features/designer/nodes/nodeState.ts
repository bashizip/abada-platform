import type { Node } from '@xyflow/react';
import type { WorkflowNode } from '@/types';
import type { DiffChangeKind } from '@/lib/aiDiff/types';
import type { EdgeKind } from '@/lib/layout/edgeGeometry';
import type { LoopProblem } from '@/lib/apl/loopAnalysis';

export type NodeRunStatus = NonNullable<WorkflowNode['status']>;

/** Data carried by every canvas node: the workflow node plus view state. */
export type CanvasNodeData = WorkflowNode & Record<string, unknown> & {
  status?: NodeRunStatus;
  isActiveSim?: boolean;
  isLiveCurrent?: boolean;
  diffKind?: DiffChangeKind | null;
  diffAnnotation?: string;
  /** Kinds of this node's outcome routes, in boundary-marker order. */
  outcomeKinds?: EdgeKind[];
  /** This step is where a cycle returns: bounded by its loop, or a problem the engine will reject. */
  loopState?: 'bounded' | LoopProblem;
  /** Engine validation issues pointing at this node. */
  issueCount?: number;
};

export type CanvasNode = Node<CanvasNodeData>;

export const SELECTED_COLOR = '#F4A261';
export const LIVE_COLOR = '#9D4EDD';

export const DIFF_COLORS: Record<DiffChangeKind, string> = {
  added: '#90A955',
  modified: '#F4A261',
  removed: '#E76F51',
};

/**
 * Outline colour for a node's state, in priority order: live position, dry-run
 * step, diff marking, selection. Null when the node is at rest.
 */
export function stateOutline(data: CanvasNodeData, selected: boolean): string | null {
  if (data.isLiveCurrent || data.isActiveSim) return LIVE_COLOR;
  if (data.diffKind) return DIFF_COLORS[data.diffKind];
  if (selected) return SELECTED_COLOR;
  return null;
}
