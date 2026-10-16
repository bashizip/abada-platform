/**
 * Tells the whole of Studio that the AI provider configuration changed: a
 * provider was saved (after its live test passed), removed, made the default,
 * or its model list was refreshed. Every view that shows provider state
 * subscribes, so a warning such as "no AI provider is configured" disappears as
 * soon as it stops being true. Other Studio tabs of the same browser are told
 * through a BroadcastChannel.
 */
import { useSyncExternalStore } from 'react';

const CHANNEL = 'abada-ai-providers';
const listeners = new Set<() => void>();
let version = 0;
let channel: BroadcastChannel | null = null;

const bump = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

const ensureChannel = () => {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => bump();
  } catch {
    channel = null;
  }
};

/** Call after any change to providers; this tab and the others refresh what they show. */
export const notifyAiProvidersChanged = (): void => {
  ensureChannel();
  bump();
  try {
    channel?.postMessage('changed');
  } catch {
    // Another tab simply refreshes on its next load.
  }
};

export const subscribeAiProviders = (listener: () => void): (() => void) => {
  ensureChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A number that changes whenever the provider configuration changes; use it as an effect dependency. */
export const useAiProvidersVersion = (): number =>
  useSyncExternalStore(subscribeAiProviders, () => version, () => version);
