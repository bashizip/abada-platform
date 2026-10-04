import { WorkflowFile } from '@/types';

/** Everything Studio persists, layout included: drives autosave. */
export const workflowFingerprint = (workflow: WorkflowFile): string =>
  JSON.stringify({
    processKey: workflow.processKey,
    name: workflow.name,
    description: workflow.description,
    category: workflow.category,
    nodes: workflow.nodes,
    edges: workflow.edges,
  });

/**
 * What a Dry Run actually validates: nodes, routes, configs and metadata.
 * Canvas positions (`ui` x/y) and runtime highlight state are left out, so
 * moving nodes or running Tidy keeps a passed Dry Run valid.
 */
export const dryRunFingerprint = (workflow: WorkflowFile): string =>
  JSON.stringify({
    processKey: workflow.processKey,
    name: workflow.name,
    description: workflow.description,
    category: workflow.category,
    languageVersion: workflow.languageVersion,
    metadataExtras: workflow.metadataExtras,
    nodes: workflow.nodes.map(({ x: _x, y: _y, status: _status, ...semantic }) => semantic),
    edges: workflow.edges.map(({ isActive: _isActive, ...semantic }) => semantic),
  });
