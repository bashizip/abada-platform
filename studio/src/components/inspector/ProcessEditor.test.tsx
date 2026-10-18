import { describe, expect, it, vi } from 'vitest';
import { ProcessEditor } from './ProcessEditor';
import { byLabel, buttons, click, render, type } from '@/test/render';
import type { AplValidationIssue } from '@/api/apl';
import type { WorkflowFile } from '@/types';

const workflow: WorkflowFile = {
  id: 'wf', name: 'Refunds', processKey: 'refunds', category: 'finance', fileType: 'apl', version: '1', updatedAt: '',
  nodes: [], edges: [],
  variables: [{ name: 'amount', type: 'number' }, { name: 'iban', sensitive: true }],
};

const mount = (overrides: Partial<WorkflowFile> = {}, issues: AplValidationIssue[] = []) => {
  const update = vi.fn();
  const container = render(<ProcessEditor workflow={{ ...workflow, ...overrides }} update={update} issues={issues} />);
  return { container, update, last: (): Partial<WorkflowFile> => update.mock.calls.at(-1)![0] };
};

describe('process editor', () => {
  it('edits the metadata, clearing a field instead of saving it empty', () => {
    const { container, last } = mount();
    type(byLabel(container, 'Process name'), 'Refund desk');
    expect(last()).toEqual({ name: 'Refund desk' });
    type(byLabel(container, 'Category'), 'payments');
    expect(last()).toEqual({ category: 'payments' });
    type(byLabel(container, 'Owner'), 'payments-team');
    expect(last()).toEqual({ owner: 'payments-team' });
    const owned = mount({ owner: 'payments-team' });
    type(byLabel(owned.container, 'Owner'), '');
    expect(owned.last()).toEqual({ owner: undefined });
  });

  it('lets an unsaved process change its key, and keeps a saved one fixed', () => {
    const draft = mount();
    type(byLabel(draft.container, 'Process key'), 'refund_desk');
    expect(draft.last()).toEqual({ processKey: 'refund_desk' });

    const saved = mount({ documentId: 'doc-1' });
    expect(byLabel<HTMLInputElement>(saved.container, 'Process key').readOnly).toBe(true);
    expect(saved.container.textContent).toContain('Fixed once the process is saved');
  });

  it('adds, edits and removes variables, leaving defaults out of the YAML', () => {
    const { container, last } = mount();
    click(buttons(container).find((button) => button.textContent?.includes('Add variable'))!);
    expect(last().variables).toEqual([...workflow.variables!, { name: 'variable' }]);

    type(byLabel(container, 'Variable type 1'), '');
    expect(last().variables![0]).toEqual({ name: 'amount' });
    click(byLabel(container, 'Variable 1 required'));
    expect(last().variables![0]).toEqual({ name: 'amount', type: 'number', required: true });
    click(byLabel(container, 'Variable 2 sensitive'));
    expect(last().variables![1]).toEqual({ name: 'iban' });

    click(byLabel(container, 'Remove variable iban'));
    expect(last().variables).toEqual([{ name: 'amount', type: 'number' }]);
    const single = mount({ variables: [{ name: 'amount' }] });
    click(byLabel(single.container, 'Remove variable amount'));
    expect(single.last()).toEqual({ variables: undefined });
  });

  it('says what the engine does with required and sensitive, and no more', () => {
    const { container } = mount();
    expect(container.innerHTML).toContain('the engine does not check it yet');
    expect(container.innerHTML).toContain('Masked in redacted agent evidence');
    expect(container.textContent).toContain('the engine does not act on them');
  });

  it('pins engine issues to their field and lists the rest at the top', () => {
    const { container } = mount({}, [
      { code: 'ABADA-APL-VALIDATION-001', severity: 'ERROR', message: "declares 'iban' more than once", path: '/metadata/variables/1/name' },
      { code: 'ABADA-APL-VALIDATION-001', severity: 'ERROR', message: 'metadata.key must match', path: '/metadata/key' },
      { code: 'ABADA-APL-VALIDATION-001', severity: 'ERROR', message: 'flow.entry is required', path: '/flow/entry' },
    ]);
    const row = byLabel(container, 'Variable name 2').closest('li')!;
    expect(row.textContent).toContain("declares 'iban' more than once");
    expect(byLabel(container, 'Process key').parentElement!.textContent).toContain('metadata.key must match');
    const general = container.querySelector('[role="status"]')!;
    expect(general.textContent).toContain('1 validation issue about the process');
    expect(general.textContent).toContain('flow.entry is required');
  });
});
