import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blur, buttons, byLabel, click, render, type } from '@/test/render';
import { AgentLimitsEditor, CallProcessEditor, DelegatesEditor } from './AgentEditors';
import { AgentToolsEditor } from './AgentToolsEditor';
import { callProcessProblem, delegatesProblem, limitsProblem } from '@/lib/apl/agentFields';
import type { CatalogTool } from '@/lib/apl/toolServers';

vi.mock('@/api/projects', () => ({ ProjectAPI: {} }));
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

afterEach(() => { document.body.innerHTML = ''; });

const catalog: CatalogTool[] = [
  { ref: 'payments/lookup', server: 'payments', tool: 'lookup', policy: 'read', approvers: [] },
  { ref: 'payments/notify', server: 'payments', tool: 'notify', policy: 'write', approvers: [] },
];

describe('agent tools editor', () => {
  it('binds tools from the catalog, only tightens, and flags names no server offers', async () => {
    const onChange = vi.fn();
    const container = render(<AgentToolsEditor projectId="p" tools={['payments/notify', 'web_search']}
      onChange={onChange} loadCatalog={async () => catalog} />);
    await settle();
    expect(container.textContent).toContain('payments/lookup');
    expect(container.textContent).toContain('advisory');
    const policy = byLabel<HTMLSelectElement>(container, 'Policy of payments/notify');
    expect([...policy.options].map((option) => option.value)).toEqual(['write', 'approval_required']);
    click(byLabel<HTMLInputElement>(container, 'Use payments/lookup'));
    expect(onChange).toHaveBeenLastCalledWith(['payments/notify', 'web_search', 'payments/lookup']);
    await act(async () => {
      policy.value = 'approval_required';
      policy.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith([{ ref: 'payments/notify', policy: 'approval_required' }, 'web_search']);
  });
});

describe('agent limits, delegates and call-process editors', () => {
  it('edits limits within the engine bounds', () => {
    const onChange = vi.fn();
    const container = render(<AgentLimitsEditor limits={{ maxTurns: 40 }} onChange={onChange} />);
    expect(container.textContent).toContain('1 to 32');
    type(byLabel<HTMLInputElement>(container, 'Budget USD'), '0.5');
    expect(onChange).toHaveBeenLastCalledWith({ budgetUsd: 0.5 });
    expect(limitsProblem({ maxTurns: 8, maxTokensTotal: 50_000, budgetUsd: 1 })).toBeNull();
    expect(limitsProblem({ budgetUsd: 0 })).toContain('more than');
  });

  it('adds delegates and requires outputs and approvers', () => {
    const onChange = vi.fn();
    const container = render(<DelegatesEditor delegates={[{ process: 'refund_payout', outputs: [] }]} onChange={onChange} />);
    expect(container.textContent).toContain('Name what "refund_payout" returns');
    const outputs = byLabel<HTMLInputElement>(container, 'Outputs of refund_payout');
    outputs.value = 'payout_id, status';
    blur(outputs);
    expect(onChange).toHaveBeenLastCalledWith([{ process: 'refund_payout', outputs: ['payout_id', 'status'] }]);
    type(byLabel<HTMLInputElement>(container, 'New delegate process'), 'large_payout');
    click(buttons(container).find((button) => button.textContent?.includes('Add'))!);
    expect(onChange).toHaveBeenLastCalledWith([{ process: 'refund_payout', outputs: [] },
      { process: 'large_payout', outputs: [] }]);
    expect(delegatesProblem([{ process: 'a', outputs: ['x'], approval: 'required' }])).toContain('approves');
    expect(delegatesProblem([{ process: 'a', outputs: ['x'] }, { process: 'a', outputs: ['y'] }])).toContain('twice');
  });

  it('maps call-process inputs and outputs and needs one output', () => {
    const onChange = vi.fn();
    const container = render(<CallProcessEditor config={{ process: 'fraud_check', outputs: {} }} onChange={onChange} />);
    expect(container.textContent).toContain('at least one output');
    type(byLabel<HTMLInputElement>(container, 'New Outputs name'), 'verdict');
    type(byLabel<HTMLInputElement>(container, 'New Outputs value'), 'fraud_verdict');
    click(buttons(container).filter((button) => button.textContent === 'Add')[1]);
    expect(onChange).toHaveBeenLastCalledWith({ process: 'fraud_check', outputs: { verdict: 'fraud_verdict' } });
    expect(callProcessProblem({ process: 'fraud_check', inputs: { amount: 'amount * 2' }, outputs: { v: 'verdict' } }))
      .toBeNull();
  });
});
