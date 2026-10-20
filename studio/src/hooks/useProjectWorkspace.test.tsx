import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowFile } from '@/types';

vi.mock('@/api/projects', () => ({ ProjectAPI: {} }));

import { createEmptyWorkflow, useProjectWorkspace } from './useProjectWorkspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('replaceWorkflow (an applied AI draft or YAML)', () => {
  it('replaces the open process as one undo step, and redo puts the draft back', () => {
    let workspace!: ReturnType<typeof useProjectWorkspace>;
    const Probe: React.FC = () => { workspace = useProjectWorkspace(false); return null; };
    const root = createRoot(document.createElement('div'));
    act(() => { root.render(<Probe />); });

    const before: WorkflowFile = {
      ...createEmptyWorkflow('wf-1', 'Invoice approval', 'invoice_approval'),
      nodes: [{ id: 'received', type: 'event', subtype: 'start', title: 'Received', description: '', x: 0, y: 0 }],
    };
    act(() => { workspace.setWorkflows([before]); workspace.setActiveWorkflowId('wf-1'); });

    const draft: WorkflowFile = {
      ...before,
      nodes: [...before.nodes,
        { id: 'review', type: 'human', title: 'Review', description: '', x: 0, y: 0 },
        { id: 'paid', type: 'event', subtype: 'end', title: 'Paid', description: '', x: 0, y: 0 }],
      edges: [{ id: 'e1', source: 'received', target: 'review' }, { id: 'e2', source: 'review', target: 'paid' }],
    };
    act(() => { expect(workspace.replaceWorkflow('wf-1', draft)).toBe(true); });
    expect(workspace.currentWorkflow.nodes.map((n) => n.id)).toEqual(['received', 'review', 'paid']);
    expect(workspace.canUndo).toBe(true);

    act(() => { workspace.undo(); });
    expect(workspace.currentWorkflow.nodes).toEqual(before.nodes);
    expect(workspace.currentWorkflow.edges).toEqual([]);
    expect(workspace.canUndo).toBe(false);

    act(() => { workspace.redo(); });
    expect(workspace.currentWorkflow.nodes.map((n) => n.id)).toEqual(['received', 'review', 'paid']);
    act(() => { root.unmount(); });
  });

  it('refuses a process that is not open', () => {
    let workspace!: ReturnType<typeof useProjectWorkspace>;
    const Probe: React.FC = () => { workspace = useProjectWorkspace(false); return null; };
    const root = createRoot(document.createElement('div'));
    act(() => { root.render(<Probe />); });
    let replaced = true;
    act(() => { replaced = workspace.replaceWorkflow('missing', createEmptyWorkflow('missing')); });
    expect(replaced).toBe(false);
    act(() => { root.unmount(); });
  });
});
