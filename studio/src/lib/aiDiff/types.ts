import { WorkflowNode, WorkflowEdge } from '@/types';

export type DiffChangeKind = 'added' | 'removed' | 'modified';

export interface DiffNodeChange {
  nodeId: string;
  kind: DiffChangeKind;
  /** YAML annotation emitted by the optimization engine for this node, if any. */
  annotation?: string;
}

export interface DiffEdgeChange {
  edgeId: string;
  kind: DiffChangeKind;
}

export interface DiffProposal {
  id: string;
  title: string;
  rationale: string;
  source: 'Insight Engine (OTel Analysis)';
  targetDefinition: string;
  createdAt: string;
  nodeChanges: DiffNodeChange[];
  edgeChanges: DiffEdgeChange[];
}

/**
 * Stores an AI-proposed optimization as a visual diff over a complete
 * workflow snapshot: both the current graph and the proposed graph are held
 * so the overlay can show every added/removed/modified element without the
 * author having to apply the change.
 */
export interface WorkflowDiffSnapshot {
  proposal: DiffProposal;
  baseNodes: WorkflowNode[];
  baseEdges: WorkflowEdge[];
  proposedNodes: WorkflowNode[];
  proposedEdges: WorkflowEdge[];
}

export const getChangeKindForNode = (
  snapshot: WorkflowDiffSnapshot | null,
  nodeId: string
): DiffChangeKind | null => {
  if (!snapshot) return null;
  return snapshot.proposal.nodeChanges.find((c) => c.nodeId === nodeId)?.kind ?? null;
};

export const getAnnotationForNode = (
  snapshot: WorkflowDiffSnapshot | null,
  nodeId: string
): string | undefined => {
  if (!snapshot) return undefined;
  return snapshot.proposal.nodeChanges.find((c) => c.nodeId === nodeId)?.annotation;
};

export const getChangeKindForEdge = (
  snapshot: WorkflowDiffSnapshot | null,
  edgeId: string
): DiffChangeKind | null => {
  if (!snapshot) return null;
  return snapshot.proposal.edgeChanges.find((c) => c.edgeId === edgeId)?.kind ?? null;
};