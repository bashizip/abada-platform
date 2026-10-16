import { describe, expect, it, vi } from 'vitest';
import { notifyAiProvidersChanged, subscribeAiProviders } from './aiProviderEvents';

describe('AI provider change events', () => {
  it('tells every subscriber, and stops after unsubscribing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeAiProviders(first);
    subscribeAiProviders(second);

    notifyAiProvidersChanged();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    stopFirst();
    notifyAiProvidersChanged();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
