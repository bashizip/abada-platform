import React from 'react';
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ToolApprovalCard, approvalArguments } from './ToolApprovalCard';
import type { ToolApprovalDTO } from '@/api/engine';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const approval: ToolApprovalDTO = {
  toolRef: 'payments/refund',
  server: 'payments',
  tool: 'refund',
  agentActivityId: 'triage',
  model: 'gemini-3.6-flash',
  attempt: 1,
  sequence: 2,
  argumentsDigest: 'a'.repeat(64),
  arguments: { order: 'A-7', amount: 40, iban: '[REDACTED]' },
  payloadMode: 'redacted',
  state: 'PROPOSED',
};

function render(value: ToolApprovalDTO): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(<ToolApprovalCard approval={value} />);
  });
  return container;
}

describe('ToolApprovalCard', () => {
  it('shows the tool, the proposing agent, the arguments and the digest the decision binds to', () => {
    const text = render(approval).textContent ?? '';
    expect(text).toContain('refund');
    expect(text).toContain('payments');
    expect(text).toContain('triage');
    expect(text).toContain('"amount": 40');
    expect(text).toContain('[REDACTED]');
    expect(text).toContain('sensitive values redacted');
    expect(text).toContain('a'.repeat(16));
  });

  it('says when the evidence policy hides the arguments instead of showing nothing', () => {
    const hidden = { ...approval, arguments: null, payloadMode: 'none' as const };
    expect(approvalArguments(hidden)).toBeNull();
    expect(render(hidden).textContent).toContain('Hidden by the project');
  });
});
