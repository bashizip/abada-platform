import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NLInputBar } from './NLInputBar';
import { byLabel, click, render, type } from '@/test/render';
import { keycloak } from '@/auth/keycloakClient';
import { nlBarStorageKey, resetNLBarModeForTests } from '@/lib/authoring/nlBarPrefs';

const bar = (container: Element) => container.querySelector('[aria-label="Draft with AI"][role="region"]');
const fab = (container: Element) => container.querySelector('button[aria-label^="Draft with AI ("]');
const press = (key: string, init: KeyboardEventInit = {}) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
});

beforeEach(() => {
  window.localStorage.clear();
  resetNLBarModeForTests();
  (keycloak as { tokenParsed?: unknown }).tokenParsed = { sub: 'alice-sub', preferred_username: 'alice' };
});
afterEach(() => {
  document.body.innerHTML = '';
  (keycloak as { tokenParsed?: unknown }).tokenParsed = undefined;
});

describe('NLInputBar', () => {
  it('says why the last request produced no process, and can be dismissed', () => {
    const onDismissError = vi.fn();
    const container = render(<NLInputBar onGenerateWorkflow={vi.fn()} isGenerating={false} hasActiveWorkflow
      error="409 No AI model is configured, so no process was generated from your description."
      onDismissError={onDismissError} />);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No AI model is configured');
    click(byLabel(container, 'Dismiss'));
    expect(onDismissError).toHaveBeenCalledOnce();
  });

  it('shows no alert when the last request succeeded', () => {
    const container = render(<NLInputBar onGenerateWorkflow={vi.fn()} isGenerating={false} hasActiveWorkflow />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('is pinned open by default and hands the prompt to the workspace', () => {
    const onGenerate = vi.fn();
    const container = render(<NLInputBar onGenerateWorkflow={onGenerate} isGenerating={false} hasActiveWorkflow />);
    expect(bar(container)).not.toBeNull();
    type(container.querySelector('#workflow-prompt') as HTMLInputElement, 'Add a manager approval');
    act(() => { (container.querySelector('form') as HTMLFormElement).requestSubmit(); });
    expect(onGenerate).toHaveBeenCalledWith('Add a manager approval', 'refine');
  });

  it('remembers collapsed and hidden per user, across a remount', () => {
    const first = render(<NLInputBar onGenerateWorkflow={vi.fn()} isGenerating={false} hasActiveWorkflow={false} />);
    click(byLabel(first, 'Collapse the bar to a button'));
    expect(window.localStorage.getItem('abada.nlBar.alice-sub')).toBe('collapsed');
    expect(nlBarStorageKey()).toBe('abada.nlBar.alice-sub');

    document.body.innerHTML = '';
    resetNLBarModeForTests();
    const second = render(<NLInputBar onGenerateWorkflow={vi.fn()} isGenerating={false} hasActiveWorkflow={false} />);
    expect(fab(second)).not.toBeNull();

    // Another user on the same browser keeps their own choice (the default, pinned).
    document.body.innerHTML = '';
    (keycloak as { tokenParsed?: unknown }).tokenParsed = { sub: 'bob-sub' };
    const third = render(<NLInputBar onGenerateWorkflow={vi.fn()} isGenerating={false} hasActiveWorkflow={false} />);
    expect(bar(third)).not.toBeNull();
    expect(fab(third)).toBeNull();
  });

  it('opens a hidden bar with ⌘K or Ctrl+K, and Esc puts it back', () => {
    window.localStorage.setItem('abada.nlBar.alice-sub', 'hidden');
    const container = render(<NLInputBar onGenerateWorkflow={vi.fn()} isGenerating={false} hasActiveWorkflow={false} />);
    expect(bar(container)).toBeNull();
    expect(fab(container)).toBeNull();

    press('k', { metaKey: true });
    expect(bar(container)).not.toBeNull();
    press('Escape');
    // The exit animation runs in motion; the preference itself is unchanged.
    expect(window.localStorage.getItem('abada.nlBar.alice-sub')).toBe('hidden');

    press('K', { ctrlKey: true });
    expect(bar(container)).not.toBeNull();
  });

  it('opens from the collapsed button', () => {
    window.localStorage.setItem('abada.nlBar.alice-sub', 'collapsed');
    const props = { onGenerateWorkflow: vi.fn(), isGenerating: false, hasActiveWorkflow: false };
    const container = render(<NLInputBar {...props} />);
    click(fab(container)!);
    expect(bar(container)).not.toBeNull();
  });

  it('stands aside while the workspace is open: no bar, no shortcut', () => {
    const container = render(<NLInputBar onGenerateWorkflow={vi.fn()} isGenerating={false} hasActiveWorkflow suspended />);
    expect(bar(container)).toBeNull();
    press('k', { metaKey: true });
    expect(bar(container)).toBeNull();
  });
});
