import type { AplValidationIssue } from '@/api/apl';
import type { Route } from '@/lib/apl/routes';
import type { WorkflowFile, WorkflowNode } from '@/types';

/** What every node editor in the properties panel receives. */
export interface NodeEditorProps {
  node: WorkflowNode;
  /** Every node of the process: route targets, reviewers. */
  nodes: WorkflowNode[];
  workflow?: WorkflowFile;
  projectId?: string;
  /** Engine issues about this node. */
  issues: AplValidationIssue[];
  /** Replaces the node. */
  update: (node: WorkflowNode) => void;
  /** Changes nodes and edges together, in one undo step. */
  updateWorkflow?: (updater: (wf: WorkflowFile) => WorkflowFile) => void;
  /** Points a route of this node (error, timeout, …) at a target, edges included. */
  routeTo: (route: Route, target: string | null) => void;
  /** Replaces the node and re-derives its route edges; `dropNext` removes its plain successor. */
  commitWithRoutes: (node: WorkflowNode, dropNext?: boolean) => void;
  /** The node's plain successor (`next`). */
  nextTarget?: string;
}
