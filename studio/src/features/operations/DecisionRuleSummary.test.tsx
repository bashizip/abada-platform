import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttons, click, render } from '@/test/render';
import type { TrailDecision } from '@/lib/run/auditTrail';
import { DecisionRuleSummary } from './DecisionRuleSummary';

const api = vi.hoisted(() => ({ decisionInputs: vi.fn() }));
vi.mock('@/api/evidence', async (original) => ({
  ...(await original<typeof import('@/api/evidence')>()),
  EvidenceAPI: api,
}));

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const decision = (patch: Partial<TrailDecision> = {}): TrailDecision => ({
  decisionKey: 'PAYOUT_ROUTE',
  rules: [{ number: 1, otherwise: false, when: 'score >= 700', then: { lane: 'fast' } }],
  inputNames: ['score', 'iban'],
  outputNames: ['lane'],
  evidenceId: 'ev-1',
  ...patch,
});

const showButton = (container: Element) => buttons(container).find((button) => button.textContent === 'Show input values');

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('decision rule summary', () => {
  it('keeps names only for history recorded before input values were kept', () => {
    const container = render(<DecisionRuleSummary decision={decision({ evidenceId: undefined })} projectId="p" instanceId="i" />);
    expect(container.textContent).toContain('Rule 1');
    expect(container.textContent).toContain('input values are not recorded');
    expect(showButton(container)).toBeUndefined();
  });

  it('keeps names only where no instance can be named', () => {
    const container = render(<DecisionRuleSummary decision={decision()} />);
    expect(container.textContent).toContain('input values are not recorded');
  });

  it('opens the input values on demand, next to the matched rule', async () => {
    api.decisionInputs.mockResolvedValueOnce({ evidenceId: 'ev-1', activityId: 'route', payloadMode: 'redacted',
      redacted: true, inputs: { score: 720, iban: '****', note: null } });
    const container = render(<DecisionRuleSummary decision={decision()} projectId="p" instanceId="i" />);
    expect(api.decisionInputs).not.toHaveBeenCalled();
    await act(async () => { click(showButton(container)!); });
    await settle();
    expect(api.decisionInputs).toHaveBeenCalledWith('p', 'i', 'ev-1');
    const values = container.querySelector('[aria-label="Input values"]')?.textContent ?? '';
    expect(values).toContain('score = 720');
    expect(values).toContain('iban = ****');
    expect(values).toContain('note = null');
    expect(container.textContent).toContain('Sensitive values are redacted');
    expect(showButton(container)).toBeUndefined();
  });

  it('says when the project keeps no input values', async () => {
    api.decisionInputs.mockResolvedValueOnce({ evidenceId: 'ev-1', activityId: 'route', payloadMode: 'none',
      redacted: false, inputs: null });
    const container = render(<DecisionRuleSummary decision={decision()} projectId="p" instanceId="i" />);
    await act(async () => { click(showButton(container)!); });
    await settle();
    expect(container.textContent).toContain('evidence policy: none');
  });

  it('explains a refusal and a purge', async () => {
    api.decisionInputs.mockRejectedValueOnce(new Error('403 Reading agent evidence payloads requires the role'));
    const container = render(<DecisionRuleSummary decision={decision()} projectId="p" instanceId="i" />);
    await act(async () => { click(showButton(container)!); });
    await settle();
    expect(container.textContent).toContain('abada-evidence-reader');

    api.decisionInputs.mockRejectedValueOnce(new Error('410 purged'));
    await act(async () => { click(showButton(container)!); });
    await settle();
    expect(container.textContent).toContain('purged after the retention period');
  });
});
