import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttons, byLabel, click, render, type } from '@/test/render';
import { ModelPricesSettings } from './ModelPricesSettings';

const api = vi.hoisted(() => ({ prices: vi.fn(), addPrice: vi.fn(), deletePrice: vi.fn() }));
vi.mock('@/api/evidence', () => ({ EvidenceAPI: api }));

const settle = () => act(async () => { await Promise.resolve(); });
const button = (container: Element, label: string) =>
  buttons(container).find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('model prices settings', () => {
  it('lists prices, adds one and removes only a scheduled one', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    api.prices.mockResolvedValue([
      { id: 'p1', model: 'gemini-3.6-flash', provider: null, inputPerMillion: 0.3, outputPerMillion: 2.5,
        effectiveFrom: '2026-10-01T00:00:00Z', createdBy: 'root', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'p2', model: 'gemini-3.6-flash', provider: 'gemini', inputPerMillion: 0.4, outputPerMillion: 3,
        effectiveFrom: future, createdBy: 'root', createdAt: '2026-10-01T00:00:00Z' },
    ]);
    api.addPrice.mockResolvedValue({});
    api.deletePrice.mockResolvedValue(undefined);
    const container = render(<ModelPricesSettings onError={() => undefined} />);
    await settle();

    expect(container.textContent).toContain('$0.3');
    expect(container.textContent).toContain('(scheduled)');
    expect(buttons(container).filter((item) => item.getAttribute('aria-label')?.startsWith('Remove'))).toHaveLength(1);

    type(byLabel<HTMLInputElement>(container, 'Model')!, 'gpt-5-mini');
    type(byLabel<HTMLInputElement>(container, 'Input price')!, '0.25');
    type(byLabel<HTMLInputElement>(container, 'Output price')!, '2');
    await act(async () => { click(button(container, 'Add price')!); });
    await settle();
    expect(api.addPrice).toHaveBeenCalledWith({ model: 'gpt-5-mini', provider: undefined, inputPerMillion: 0.25,
      outputPerMillion: 2, effectiveFrom: undefined });

    await act(async () => { click(button(container, 'Remove scheduled price for gemini-3.6-flash')!); });
    expect(api.deletePrice).toHaveBeenCalledWith('p2');
  });
});
