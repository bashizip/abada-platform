import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttons, click, render } from '@/test/render';
import { AiProvidersSettings } from './AiProvidersSettings';

const api = vi.hoisted(() => ({
  list: vi.fn(), status: vi.fn(), models: vi.fn(), save: vi.fn(), remove: vi.fn(), test: vi.fn(), refreshModels: vi.fn(),
}));
const events = vi.hoisted(() => ({ notifyAiProvidersChanged: vi.fn() }));
vi.mock('@/api/aiProviders', () => ({ AiProvidersAPI: api }));
vi.mock('@/lib/aiProviderEvents', () => events);

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const button = (container: Element, text: string) =>
  buttons(container).find((item) => item.textContent?.trim() === text || item.getAttribute('aria-label') === text);

const gemini = {
  id: 'gemini', displayName: 'Google Gemini', providerType: 'gemini', baseUrl: null, apiKeyHint: '****tO_Q',
  modelPatterns: ['gemini', 'google/'], defaultModel: 'gemini-3.6-flash', timeoutMs: 30000, enabled: true,
  insightDefault: true, saved: true, configured: true, activeSource: 'STUDIO', environmentConfigured: false,
  environmentKeyHint: null,
};

const open = async () => {
  api.list.mockResolvedValue([gemini]);
  api.status.mockResolvedValue({ configured: true, unconfiguredModels: [], insightProviderId: 'gemini',
    insightModel: 'gemini-3.6-flash', requestedInsightProviderId: 'gemini', insightFallback: false });
  api.models.mockResolvedValue([{ providerId: 'gemini', models: ['gemini-3.6-flash', 'gemini-3.8-flash'],
    refreshedAt: '2026-10-16T10:00:00Z', lastError: null }]);
  const onError = vi.fn();
  const container = render(<AiProvidersSettings onError={onError} />);
  await settle();
  await act(async () => { click(button(container, 'Edit Google Gemini')!); });
  return { container, onError };
};

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('AI providers settings', () => {
  it('shows the models the provider listed', async () => {
    const { container } = await open();
    expect(container.querySelectorAll('option[value="gemini-3.8-flash"]').length).toBeGreaterThan(0);
  });

  it('saves only through a test, and tells the rest of Studio once it is saved', async () => {
    const { container, onError } = await open();
    api.save.mockRejectedValueOnce(new Error('The provider did not answer a test call, so nothing was saved: HTTP 401'));

    await act(async () => { click(button(container, 'Test & save')!); });
    await settle();
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('HTTP 401'));
    expect(events.notifyAiProvidersChanged).not.toHaveBeenCalled();

    api.save.mockResolvedValueOnce(gemini);
    await act(async () => { click(button(container, 'Test & save')!); });
    await settle();
    expect(events.notifyAiProvidersChanged).toHaveBeenCalledTimes(1);
  });
});
