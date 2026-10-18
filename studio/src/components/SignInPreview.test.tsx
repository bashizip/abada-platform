import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '@/test/render';
import { MotionProvider } from '@/components/ui';
import { SignInPreview } from './SignInPreview';

const entries = (container: HTMLElement) =>
  [...container.querySelectorAll('[aria-label="Audit trail"] li')].map((item) => item.textContent ?? '');

describe('SignInPreview', () => {
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('plays the example run once, one entry per step, then offers to play it again', () => {
    vi.useFakeTimers();
    const container = render(<MotionProvider><SignInPreview /></MotionProvider>);
    expect(entries(container)).toEqual(['Starting…']);
    act(() => { vi.advanceTimersByTime(900); });
    expect(entries(container)).toHaveLength(1);
    expect(entries(container)[0]).toContain('Agent advised');
    // Each step schedules the next once it is on screen.
    for (let step = 2; step <= 4; step += 1) {
      act(() => { vi.advanceTimersByTime(1100); });
      expect(entries(container)).toHaveLength(step);
    }
    expect(entries(container)[3]).toContain('Run completed');
    expect(container.textContent).toContain('Completed');
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(entries(container)).toHaveLength(4);

    const again = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Play again'))!;
    expect(again.disabled).toBe(false);
    click(again);
    expect(entries(container)).toEqual(['Starting…']);
  });

  it('labels itself as an example', () => {
    expect(render(<MotionProvider><SignInPreview /></MotionProvider>).textContent).toContain('Example run');
  });
});
