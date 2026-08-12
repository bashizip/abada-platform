import { WorkflowFile } from '@/types';

export const workflowFingerprint = (workflow: WorkflowFile): string =>
  JSON.stringify({
    processKey: workflow.processKey,
    name: workflow.name,
    description: workflow.description,
    category: workflow.category,
    nodes: workflow.nodes,
    edges: workflow.edges,
  });
