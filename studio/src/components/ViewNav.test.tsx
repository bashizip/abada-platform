import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, click } from '@/test/render';
import { MotionProvider } from '@/components/ui';
import { ViewNav } from './ViewNav';
import { navTabFor, switchDirection } from '@/lib/studioViews';

const current = (container: HTMLElement) => container.querySelector('[aria-current="page"]')?.textContent;

describe('ViewNav', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('keeps Operations highlighted on an instance page, wherever it was opened from', () => {
    expect(navTabFor('instance')).toBe('operations');
    const container = render(<MotionProvider><ViewNav currentView="instance" showAdmin={false} /></MotionProvider>);
    expect(current(container)).toBe('Operations');
  });

  it('highlights the tab of every top-level view', () => {
    const labels = { designer: 'Canvas', inbox: 'Task Inbox', operations: 'Operations', insight: 'Insight', administration: 'Admin' } as const;
    for (const [view, label] of Object.entries(labels)) {
      const container = render(<MotionProvider><ViewNav currentView={view as keyof typeof labels} showAdmin /></MotionProvider>);
      expect(current(container)).toBe(label);
    }
  });

  it('shows Admin only to administrators and reports the chosen tab', () => {
    const onViewChange = vi.fn();
    const container = render(<MotionProvider><ViewNav currentView="designer" onViewChange={onViewChange} showAdmin={false} /></MotionProvider>);
    expect(container.textContent).not.toContain('Admin');
    click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Operations')!);
    expect(onViewChange).toHaveBeenCalledWith('operations');
  });

  it('brings a view in from the side of its tab', () => {
    expect(switchDirection('designer', 'operations')).toBe(1);
    expect(switchDirection('insight', 'inbox')).toBe(-1);
    expect(switchDirection('operations', 'instance')).toBe(1);
    expect(switchDirection('instance', 'operations')).toBe(-1);
    expect(switchDirection('inbox', 'inbox')).toBe(0);
  });
});
