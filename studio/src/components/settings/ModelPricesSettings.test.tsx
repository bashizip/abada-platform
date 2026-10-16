import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttons, byLabel, click, render, type } from '@/test/render';
import { ModelPricesSettings } from './ModelPricesSettings';

const api = vi.hoisted(() => ({
  prices: vi.fn(), addPrice: vi.fn(), deletePrice: vi.fn(),
  effectivePrices: vi.fn(), priceCatalog: vi.fn(), refreshPriceCatalog: vi.fn(),
}));
const providers = vi.hoisted(() => ({ models: vi.fn() }));
vi.mock('@/api/evidence', () => ({ EvidenceAPI: api }));
vi.mock('@/api/aiProviders', () => ({ AiProvidersAPI: providers }));

const catalogStatus = {
  enabled: true, url: 'https://openrouter.ai/api/v1/models', refreshedAt: new Date().toISOString(),
  status: 'OK', message: null, modelCount: 367, snapshotTaken: '2026-10-16T00:00:00Z',
};

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
    api.effectivePrices.mockResolvedValue([]);
    api.priceCatalog.mockResolvedValue(catalogStatus);
    providers.models.mockResolvedValue([]);
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

  it('shows where each price in effect comes from and prefills the form to set your own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.prices.mockResolvedValue([]);
    api.priceCatalog.mockResolvedValue(catalogStatus);
    providers.models.mockResolvedValue([{ providerId: 'gemini', models: ['gemini-3.8-flash'], refreshedAt: null, lastError: null }]);
    api.effectivePrices.mockResolvedValue([
      { model: 'gemini-3.6-flash', inputPerMillion: 0.3, outputPerMillion: 2.5, source: 'ADMIN',
        catalogModel: null, catalogSource: null, effectiveFrom: '2026-10-01T00:00:00Z' },
      { model: 'gemini-3.8-flash', inputPerMillion: 0.825, outputPerMillion: 4.125, source: 'CATALOG',
        catalogModel: 'google/gemini-3.8-flash', catalogSource: 'catalog:openrouter.ai', effectiveFrom: '2026-10-16T00:00:00Z' },
      { model: 'mystery-model', inputPerMillion: null, outputPerMillion: null, source: 'NONE',
        catalogModel: null, catalogSource: null, effectiveFrom: null },
    ]);
    const container = render(<ModelPricesSettings onError={() => undefined} />);
    await settle();
    await act(async () => { vi.advanceTimersByTime(300); });
    await settle();

    expect(api.effectivePrices).toHaveBeenCalledWith(expect.arrayContaining(['gemini-3.8-flash']));
    expect(container.textContent).toContain('Catalog openrouter.ai');
    expect(container.textContent).toContain('367 models');
    expect(container.textContent).toContain('Your price');
    expect(container.textContent).toContain('Public catalog');
    expect(container.textContent).toContain('Unpriced');
    expect(container.textContent).not.toContain('every agent call is unpriced');

    await act(async () => { click(button(container, 'Set your price for gemini-3.8-flash')!); });
    expect(byLabel<HTMLInputElement>(container, 'Model')!.value).toBe('gemini-3.8-flash');
    expect(byLabel<HTMLInputElement>(container, 'Input price')!.value).toBe('0.825');
    vi.useRealTimers();
  });
});
