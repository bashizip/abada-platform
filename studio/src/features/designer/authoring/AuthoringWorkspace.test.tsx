import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowFile, WorkflowNode } from '@/types';
import { byLabel, click, render, type } from '@/test/render';
import { parseAPLYaml } from '@/lib/apl/parser';

const generate = vi.fn();
vi.mock('@/api/authoring', () => ({ AuthoringAPI: { generate: (...args: unknown[]) => generate(...args) } }));
vi.mock('@/hooks/useAplValidation', () => ({
  useAplValidation: (draft: WorkflowFile | null) => {
    // Stands in for an engine rule: a human step must be assigned to finance.
    const missing = (draft?.nodes ?? []).filter((node) => node.type === 'human' && !node.humanConfig?.assignees?.includes('finance'));
    return {
      issueCounts: new Map(missing.map((node) => [node.id, 1])),
      issuesByNode: new Map(missing.map((node) => [node.id, [{ message: 'No assignees' }]])),
      processIssues: [],
    };
  },
}));
// The diagram is ReactFlow + ELK; the workspace logic is what is under test here.
vi.mock('../DraftDiagram', () => ({
  DraftDiagram: ({ nodes, onSelectNode, issueCounts, nodeDiffKind }: {
    nodes: WorkflowNode[]; onSelectNode?: (id: string) => void; issueCounts?: Map<string, number>;
    nodeDiffKind?: (id: string) => string | null;
  }) => (
    <ul data-testid="draft-diagram">
      {nodes.map((node) => (
        <li key={node.id} data-node={node.id} data-issues={issueCounts?.get(node.id) ?? 0}
          data-diff={nodeDiffKind?.(node.id) ?? ''}>
          <button type="button" onClick={() => onSelectNode?.(node.id)}>{node.title}</button>
        </li>
      ))}
    </ul>
  ),
}));
vi.mock('@/components/PropertiesInspector', () => ({
  PropertiesInspector: ({ selectedNode, onUpdateNode }: { selectedNode: WorkflowNode; onUpdateNode: (n: WorkflowNode) => void }) => (
    <button type="button" aria-label="Assign to finance"
      onClick={() => onUpdateNode({ ...selectedNode, humanConfig: { ...selectedNode.humanConfig, assignees: ['finance'] } } as WorkflowNode)}>
      assign
    </button>
  ),
}));

import { AuthoringWorkspace } from './AuthoringWorkspace';

const CREATED = `version: abada.io/v1
metadata:
  key: invoice_approval
  name: Invoice approval
flow:
  entry: received
  nodes:
    - id: received
      type: webhook
      description: Invoice received
      next: review
    - id: review
      type: human-input
      description: Finance review
      assignees: [finance]
      next: paid
    - id: paid
      type: end
      description: Invoice paid
`;

const REFINED = CREATED.replace(`      next: paid
    - id: paid`, `      next: manager
    - id: manager
      type: human-input
      description: Manager approval
      next: paid
    - id: paid`);

const origin: WorkflowFile = {
  id: 'wf-1', name: 'Invoice approval', version: '1.0.0', updatedAt: '2026-10-20T00:00:00Z', documentId: 'doc-1', revision: 3,
  category: 'custom', fileType: 'apl',
  nodes: [], edges: [],
} as WorkflowFile;

interface Deferred { resolve: (value: unknown) => void; reject: (error: unknown) => void; signal?: AbortSignal; args: unknown[] }
let calls: Deferred[] = [];

beforeEach(() => {
  calls = [];
  generate.mockImplementation((...args: unknown[]) => new Promise((resolve, reject) => {
    calls.push({ resolve, reject, signal: args[4] as AbortSignal | undefined, args });
  }));
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

const answer = async (index: number, aplSource: string, extra: Record<string, unknown> = {}) => {
  await act(async () => {
    calls[index].resolve({ aplSource, provider: 'LLM', model: 'stub', attempts: 1, warnings: [], ...extra });
  });
};
const fail = async (index: number, message: string) => {
  await act(async () => { calls[index].reject(new Error(message)); });
};
const turns = (container: Element) => [...container.querySelectorAll('[data-testid="authoring-turn"]')];
const nodeIds = (container: Element) => [...container.querySelectorAll('[data-node]')].map((el) => el.getAttribute('data-node'));
const buttonNamed = (container: Element, text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const refine = (container: Element, text: string) => {
  type(byLabel<HTMLInputElement>(container, 'Refine the draft'), text);
  act(() => { (byLabel<HTMLInputElement>(container, 'Refine the draft').form as HTMLFormElement).requestSubmit(); });
};

const open = (props: Partial<React.ComponentProps<typeof AuthoringWorkspace>> = {}) => {
  const onApply = vi.fn();
  const onDiscard = vi.fn();
  const container = render(<AuthoringWorkspace projectId="p1" origin={origin} target="new"
    initialPrompt="Invoice approval with a finance review" onApply={onApply} onDiscard={onDiscard} {...props} />);
  return { container, onApply, onDiscard };
};

describe('AuthoringWorkspace', () => {
  it('opens on the submitted prompt with a pending turn, then shows the draft', async () => {
    const { container } = open();
    expect(generate).toHaveBeenCalledWith('p1', 'Invoice approval with a finance review', 'new', undefined, expect.any(AbortSignal));
    expect(turns(container)[0].getAttribute('data-status')).toBe('pending');
    expect(container.textContent).toContain('Drafting your process');
    expect(buttonNamed(container, 'Apply to Studio').disabled).toBe(true);

    await answer(0, CREATED);
    expect(turns(container)[0].getAttribute('data-status')).toBe('done');
    expect(nodeIds(container)).toEqual(['received', 'review', 'paid']);
    expect(buttonNamed(container, 'Apply to Studio').disabled).toBe(false);
  });

  it('refines from the draft as the user sees it, including a direct edit, and updates the preview', async () => {
    const { container } = open();
    await answer(0, CREATED);
    refine(container, 'A manager approves too');
    expect(generate).toHaveBeenLastCalledWith('p1', 'A manager approves too', 'refine', expect.stringContaining('id: review'),
      expect.any(AbortSignal));
    await answer(1, REFINED, { summary: 'Added a manager approval.', patch: [{ op: 'addNode' }] });
    expect(nodeIds(container)).toContain('manager');
    expect(container.querySelector('[data-node="manager"]')?.getAttribute('data-issues')).toBe('1');
    expect(container.textContent).toContain('Added a manager approval.');

    // A direct edit becomes a turn, clears the issue, and the next refinement starts from it.
    click(buttonNamed(container, 'Manager'));
    click(byLabel(container, 'Assign to finance'));
    expect(container.querySelector('[data-node="manager"]')?.getAttribute('data-issues')).toBe('0');
    expect(turns(container).at(-1)?.textContent).toContain('Your edit');
    refine(container, 'Rename the end');
    const base = parseAPLYaml(generate.mock.calls.at(-1)?.[3] as string);
    expect(base.flow.nodes.find((node) => node.id === 'manager')).toMatchObject({ assignees: ['finance'] });
  });

  it('undoes to an earlier turn and can restore it', async () => {
    const { container } = open();
    await answer(0, CREATED);
    refine(container, 'A manager approves too');
    await answer(1, REFINED);
    click(buttonNamed(container, 'Undo to here'));
    expect(nodeIds(container)).not.toContain('manager');
    expect(container.textContent).toContain('1 later step set aside');
    click(buttonNamed(container, 'Restore'));
    expect(nodeIds(container)).toContain('manager');
  });

  it('keeps the draft when a refinement fails, and tries again', async () => {
    const { container } = open();
    await answer(0, CREATED);
    refine(container, 'Break it');
    await fail(1, '409 The model could not produce a valid change within 3 attempts.');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('The draft is unchanged');
    expect(nodeIds(container)).toEqual(['received', 'review', 'paid']);
    click(buttonNamed(container, 'Try again'));
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls[2][1]).toBe('Break it');
  });

  it('cancels a pending refinement and ignores its late answer', async () => {
    const { container } = open();
    await answer(0, CREATED);
    refine(container, 'Slow change');
    click(buttonNamed(container, 'Cancel'));
    expect(calls[1].signal?.aborted).toBe(true);
    await answer(1, REFINED);
    expect(nodeIds(container)).not.toContain('manager');
    expect(turns(container)).toHaveLength(1);
  });

  it('shows the diff against the process on the canvas', async () => {
    const replaceOrigin = { ...origin, nodes: [{ id: 'received', type: 'event', subtype: 'start', title: 'Invoice received', description: '', x: 0, y: 0 }] } as WorkflowFile;
    const { container } = open({ origin: replaceOrigin, target: 'replace' });
    expect(generate.mock.calls[0][2]).toBe('refine');
    await answer(0, CREATED);
    click(buttonNamed(container, 'Diff vs current'));
    expect(container.querySelector('[data-node="review"]')?.getAttribute('data-diff')).toBe('added');
    expect(container.querySelector('[data-testid="diff-summary"]')?.textContent).toContain('2 added');
  });

  it('discards after confirming, without applying anything', async () => {
    const { container, onApply, onDiscard } = open();
    await answer(0, CREATED);
    click(buttonNamed(container, 'Discard'));
    expect(onDiscard).not.toHaveBeenCalled();
    click(buttonNamed(container, 'Discard draft'));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies the final draft once, keeping the identity of the process it replaces', async () => {
    const { container, onApply } = open({ target: 'replace' });
    await answer(0, CREATED);
    refine(container, 'A manager approves too');
    await answer(1, REFINED);
    click(buttonNamed(container, 'Apply to Studio'));
    expect(onApply).toHaveBeenCalledOnce();
    const applied = onApply.mock.calls[0][0] as WorkflowFile;
    expect(applied.nodes.map((n) => n.id)).toContain('manager');
    expect(applied).toMatchObject({ id: 'wf-1', documentId: 'doc-1', revision: 3 });
  });
});
