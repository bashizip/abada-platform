import type { Node } from '@xyflow/react';
import type { WorkflowNode } from '@/types';
import type { DiffChangeKind } from '@/lib/aiDiff/types';
import type { EdgeKind } from '@/lib/layout/edgeGeometry';
import type { LoopProblem } from '@/lib/apl/loopAnalysis';
import type { NowState } from '@/lib/run/instancePath';
import type { RetryPhase } from '@/lib/run/retryPhase';
import { palette } from '@/lib/tokens';

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
  /** Instance views: the path ran through this node, or never reached it (dimmed unless the full diagram is shown). */
  pathLayer?: 'taken' | 'unreached';
  /** Instance views: 1-based visit numbers on the path. */
  visitOrders?: number[];
  /** Instance views: where the instance is now. */
  nowState?: NowState;
  /** Instance views: branches arrived at a join over those expected. */
  join?: { arrived: number; expected: number };
  /** Instance views: results of the children a delegation or for-each started. */
  childResults?: { ok: number; failed: number };
  /** Instance views: what the path says about this node, for its tooltip. */
  pathHint?: string;
  /** Paced playback: set (to the arrival's sequence number) while this node is the one a revealed step entered. */
  arrivalSeq?: number;
  /** Instance views: identity of the open incident on this node; a new one pulses once (M5 S4). */
  incidentSeq?: string;
  /** Instance views: where a retry of this node is, shown at the playback pace (M5 S4). */
  retryPhase?: RetryPhase;
};

export type CanvasNode = Node<CanvasNodeData>;

export const SELECTED_COLOR = palette.saffron;
export const LIVE_COLOR = palette.amethyst;

/** A retry passing through its phases: reopened, running, done, failed again. */
export const RETRY_COLORS: Record<RetryPhase, string> = {
  retrying: palette.saffron,
  active: palette.amethyst,
  completed: palette.sageGreen,
  failed: palette.desertRose,
};

export const DIFF_COLORS: Record<DiffChangeKind, string> = {
  added: palette.sageGreen,
  modified: palette.saffron,
  removed: palette.desertRose,
};

/**
 * Outline colour for a node's state, in priority order: a retry in progress, live position, dry-run
 * step, diff marking, selection. Null when the node is at rest.
 */
export function stateOutline(data: CanvasNodeData, selected: boolean): string | null {
  if (data.retryPhase) return RETRY_COLORS[data.retryPhase];
  if (data.nowState === 'incident') return palette.desertRose;
  if (data.nowState === 'waiting') return palette.saffron;
  if (data.isLiveCurrent || data.isActiveSim) return LIVE_COLOR;
  if (data.diffKind) return DIFF_COLORS[data.diffKind];
  if (selected) return SELECTED_COLOR;
  return null;
}

/** Class of a node's path layer: a node never reached fades until hovered. */
export const pathClass = (data: CanvasNodeData): string =>
  data.pathLayer === 'unreached' ? 'abada-path-unreached' : '';

/** A node on the path is filled with a tint of its own colour; any other keeps the plain card. */
export const pathFill = (data: CanvasNodeData, accent: string): string =>
  data.pathLayer === 'taken' ? `color-mix(in srgb, ${accent} 18%, ${palette.mocha})` : palette.mocha;

/** Tooltip text: the node's own description, then what the path says about it. */
export const withPathHint = (data: CanvasNodeData, base: string | undefined): string | undefined =>
  [base, data.pathHint].filter(Boolean).join('\n') || undefined;
