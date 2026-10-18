import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/render';
import { MotionProvider } from '@/components/ui';
import { HOLD_MS, SignInPreview } from './SignInPreview';

/** The audit rows reached so far, or the "Starting…" placeholder before the first. */
const entries = (container: HTMLElement) => {
  const shown = [...container.querySelectorAll('[aria-label="Audit trail"] li[data-shown]')].map((item) => item.textContent ?? '');
  return shown.length > 0 ? shown : [...container.querySelectorAll('[aria-label="Audit trail"] + p')].map((item) => item.textContent ?? '');
};

describe('SignInPreview', () => {
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('plays the example run one entry per step, holds the finished run, then starts again', () => {
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
    act(() => { vi.advanceTimersByTime(HOLD_MS - 100); });
    expect(entries(container)).toHaveLength(4);
    act(() => { vi.advanceTimersByTime(100); });
    expect(entries(container)).toEqual(['Starting…']);
    expect(container.textContent).not.toContain('Play again');
  });

  it('lays out every audit row from the start, so the card keeps its height while the run plays', () => {
    vi.useFakeTimers();
    const container = render(<MotionProvider><SignInPreview /></MotionProvider>);
    const rows = () => container.querySelectorAll('[aria-label="Audit trail"] li').length;
    expect(rows()).toBe(4);
    act(() => { vi.advanceTimersByTime(900); });
    act(() => { vi.advanceTimersByTime(1100); });
    expect(rows()).toBe(4);
    expect(entries(container)).toHaveLength(2);
  });

  it('moves the token and draws the edge with transforms, not layout properties', () => {
    vi.useFakeTimers();
    const container = render(<MotionProvider><SignInPreview /></MotionProvider>);
    act(() => { vi.advanceTimersByTime(900); });
    const token = container.querySelector('[data-token]') as HTMLElement;
    const edge = container.querySelector('[data-edge]') as HTMLElement;
    expect(token).not.toBeNull();
    for (const element of [token, edge]) {
      expect(element.style.left).toBe('');
      expect(element.style.width).toBe('');
    }
  });

  it('labels itself as an example', () => {
    expect(render(<MotionProvider><SignInPreview /></MotionProvider>).textContent).toContain('Example run');
  });
});
