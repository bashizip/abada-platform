import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click, render } from '@/test/render';
import { WhatsNewCard } from './WhatsNewCard';
import { WHATS_NEW_KEY, docsLink, minorOf, releaseNotesLink, shouldShowWhatsNew } from '@/lib/studioRelease';

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
});

describe("what's new", () => {
  it('shows once after moving to a minor release with highlights, then stays dismissed', async () => {
    window.localStorage.setItem(WHATS_NEW_KEY, '1.1');
    const container = render(<WhatsNewCard version="1.2.0" />);
    const card = document.querySelector('[role="dialog"]');
    expect(card?.textContent).toContain("What's new in 1.2");
    expect(card?.textContent).toContain('Agents that read scanned documents');
    expect(card?.querySelector('a')?.getAttribute('href')).toBe('https://docs.abadaplatform.com/release-notes/1-2/');

    await act(async () => { click(container.querySelector('[aria-label="Dismiss what\'s new"]')!); });
    expect(window.localStorage.getItem(WHATS_NEW_KEY)).toBe('1.2');
    document.body.innerHTML = '';
    render(<WhatsNewCard version="1.2.3" />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('decides from the stored release', () => {
    expect(shouldShowWhatsNew(null, '1.2.0')).toBe(true);
    expect(shouldShowWhatsNew('1.1', '1.2.0')).toBe(true);
    expect(shouldShowWhatsNew('1.2', '1.2.4')).toBe(false);
    expect(shouldShowWhatsNew('1.3', '1.2.0')).toBe(false);
    expect(shouldShowWhatsNew(null, '1.1.2')).toBe(false);
    expect(minorOf('1.2.0')).toBe('1.2');
    expect(docsLink('/user/operations/')).toBe('https://docs.abadaplatform.com/user/operations/');
    expect(releaseNotesLink('1.1.2')).toBe('https://docs.abadaplatform.com/release-notes/1-1/');
  });
});
