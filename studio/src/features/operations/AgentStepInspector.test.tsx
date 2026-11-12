import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttons, click, render } from '@/test/render';
import type { AgentStepEvidence } from '@/api/evidence';
import { AgentStepInspector } from './AgentStepInspector';

const api = vi.hoisted(() => ({ payloads: vi.fn() }));
vi.mock('@/api/evidence', async (original) => ({
  ...(await original<typeof import('@/api/evidence')>()),
  EvidenceAPI: api,
}));

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const step = (patch: Partial<AgentStepEvidence>): AgentStepEvidence => ({
  id: `s${patch.sequence}`, externalTaskId: 't1', activityId: 'triage', attempt: 1, sequence: 1,
  kind: 'MODEL_CALL', state: 'COMPLETED', costUnpriced: false, payloadMode: 'redacted',
  startedAt: '2026-10-05T10:00:00Z', ...patch,
});

const steps: AgentStepEvidence[] = [
  step({ sequence: 1, model: 'gemini-3.6-flash', promptTokens: 100, completionTokens: 20, costUsd: 0.0012 }),
  step({ sequence: 2, kind: 'TOOL_CALL', toolRef: 'payments/refund', policy: 'approval_required', state: 'APPROVED',
    resolvedBy: 'fiona', decidedAt: '2026-10-05T10:05:00Z' }),
  step({ sequence: 3, kind: 'TOOL_CALL', toolRef: 'crm/notify', policy: 'write', state: 'OUTCOME_UNKNOWN' }),
  step({ attempt: 2, sequence: 1, kind: 'DELEGATION', toolRef: 'delegate:refund_payout', policy: 'delegate',
    state: 'STARTED', childInstanceId: 'child-123456789' }),
  step({ attempt: 2, sequence: 2, model: 'no-price', costUnpriced: true, promptTokens: 5, completionTokens: 5 }),
];

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('agent step inspector', () => {
  it('shows every step by attempt with policy, approval, unknown outcome, delegation and cost', () => {
    const open = vi.fn();
    const container = render(<AgentStepInspector steps={steps} projectId="p" instanceId="i" onOpenInstance={open} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Steps (5)');
    expect(text).toContain('Attempt 1');
    expect(text).toContain('Attempt 2');
    expect(text).toContain('approval required');
    expect(text).toContain('approved by fiona');
    expect(text).toContain('outcome unknown');
    expect(text).toContain('delegate:refund_payout');
    expect(text).toContain('130 tokens');
    expect(text).toContain('$0.0012');
    expect(text).toContain('+ unpriced');
    click(buttons(container).find((button) => button.textContent?.startsWith('child'))!);
    expect(open).toHaveBeenCalledWith('child-123456789');
  });

  it('opens payloads for evidence readers and explains a refusal', async () => {
    api.payloads.mockResolvedValueOnce({ stepId: 's1', payloadMode: 'redacted', request: { messages: ['[REDACTED]'] },
      result: { content: 'ok' } });
    const container = render(<AgentStepInspector steps={steps.slice(0, 2)} projectId="p" instanceId="i" />);
    await act(async () => { click(buttons(container).find((button) => button.getAttribute('aria-label') === 'Step 1.1')!); });
    await settle();
    expect(api.payloads).toHaveBeenCalledWith('p', 'i', 's1');
    expect(container.textContent).toContain('[REDACTED]');
    expect(container.textContent).toContain('Sensitive values are redacted');

    api.payloads.mockRejectedValueOnce(new Error('403 Reading agent evidence payloads requires the role'));
    await act(async () => { click(buttons(container).find((button) => button.getAttribute('aria-label') === 'Step 1.2')!); });
    await settle();
    expect(container.textContent).toContain('abada-evidence-reader');
  });

  it('shows the files a model call read, with their sha256, as downloadable chips', () => {
    const sha = 'a1b2c3d4e5f6'.padEnd(64, '0');
    const container = render(<AgentStepInspector projectId="p" instanceId="i" steps={[step({
      sequence: 1, model: 'gemini-3.6-flash', payloadMode: 'none',
      files: [{ name: 'bordereau', fileId: 'f-1', fileName: 'bordereau-2026-10.pdf', contentType: 'application/pdf',
        size: 4200, sha256: sha }],
    })]} />);
    const files = container.querySelector('[aria-label="Files of step 1.1"]');
    expect(files?.textContent).toContain('bordereau-2026-10.pdf');
    expect(files?.textContent).toContain('a1b2c3d4e5f6');
    expect(files?.querySelector('button[title^="Download bordereau-2026-10.pdf"]')).not.toBeNull();
  });

  it('shows no file line for a call without files', () => {
    const container = render(<AgentStepInspector steps={steps} projectId="p" instanceId="i" />);
    expect(container.querySelector('[aria-label^="Files of step"]')).toBeNull();
  });
});
