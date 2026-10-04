import { describe, expect, it } from 'vitest';
import { WorkflowFile } from '@/types';
import { dryRunFingerprint, workflowFingerprint } from './workflowFingerprint';

const workflow: WorkflowFile = {
  id: 'wf-1', name: 'Lead triage', category: 'custom', fileType: 'apl', version: '1', updatedAt: '',
  processKey: 'lead-triage',
  nodes: [
    { id: 'start', type: 'event', subtype: 'start', title: 'Start', description: '', x: 0, y: 0 },
    { id: 'review', type: 'human', title: 'Review', description: '', x: 200, y: 0 },
    { id: 'end', type: 'event', subtype: 'end', title: 'End', description: '', x: 400, y: 0 },
  ],
  edges: [
    { id: 'e_start_review', source: 'start', target: 'review' },
    { id: 'e_review_end', source: 'review', target: 'end' },
  ],
};

describe('dryRunFingerprint', () => {
  it('keeps a passed Dry Run valid after a layout-only change (Tidy)', () => {
    const tidied: WorkflowFile = {
      ...workflow,
      nodes: workflow.nodes.map((node, index) => ({ ...node, x: 80 + index * 260, y: 120 + index * 10, status: 'completed' })),
      edges: workflow.edges.map((edge) => ({ ...edge, isActive: true })),
    };

    expect(dryRunFingerprint(tidied)).toBe(dryRunFingerprint(workflow));
    // Autosave still sees the moved nodes.
    expect(workflowFingerprint(tidied)).not.toBe(workflowFingerprint(workflow));
  });

  it('invalidates the Dry Run when a route is added', () => {
    const rerouted: WorkflowFile = {
      ...workflow,
      edges: [...workflow.edges, { id: 'e_start_end', source: 'start', target: 'end', condition: 'amount < 100' }],
    };

    expect(dryRunFingerprint(rerouted)).not.toBe(dryRunFingerprint(workflow));
  });

  it('invalidates the Dry Run when node config or metadata changes', () => {
    const retitled: WorkflowFile = {
      ...workflow,
      nodes: workflow.nodes.map((node) => (node.id === 'review' ? { ...node, title: 'Approve' } : node)),
    };
    const reowned: WorkflowFile = { ...workflow, metadataExtras: { owner: 'finance' } };

    expect(dryRunFingerprint(retitled)).not.toBe(dryRunFingerprint(workflow));
    expect(dryRunFingerprint(reowned)).not.toBe(dryRunFingerprint(workflow));
  });
});
