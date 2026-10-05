import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttons, byLabel, click, render, type } from '@/test/render';
import { EvidencePolicyCard } from './EvidencePolicyCard';

const api = vi.hoisted(() => ({ policy: vi.fn(), setPolicy: vi.fn() }));
vi.mock('@/api/evidence', () => ({ EvidenceAPI: api }));

const settle = () => act(async () => { await Promise.resolve(); });

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('evidence policy card', () => {
  it('lets an owner tighten the policy', async () => {
    api.policy.mockResolvedValue({ payloads: 'redacted', retentionDays: 30 });
    api.setPolicy.mockImplementation(async (_project: string, policy: unknown) => policy);
    const container = render(<EvidencePolicyCard projectId="proj" canEdit />);
    await settle();

    click(container.querySelector('input[value="none"]')!);
    type(byLabel<HTMLInputElement>(container, 'Retention days')!, '7');
    await act(async () => { click(buttons(container).find((item) => item.textContent?.trim() === 'Save')!); });
    await settle();
    expect(api.setPolicy).toHaveBeenCalledWith('proj', { payloads: 'none', retentionDays: 7 });
    expect(container.textContent).toContain('applies to agent steps recorded from now on');
  });

  it('is read-only for other members', async () => {
    api.policy.mockResolvedValue({ payloads: 'full', retentionDays: 90 });
    const container = render(<EvidencePolicyCard projectId="proj" canEdit={false} />);
    await settle();
    expect(buttons(container).find((item) => item.textContent?.trim() === 'Save')).toBeUndefined();
    expect(byLabel<HTMLInputElement>(container, 'Retention days')!.disabled).toBe(true);
  });
});
