import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/render';
import type { StreamOptions } from '@/api/eventStream';
import { useInstanceEvents } from './useInstanceEvents';

const opened = vi.hoisted(() => ({ options: undefined as StreamOptions | undefined, close: vi.fn() }));
vi.mock('@/api/eventStream', () => ({
  openProjectStream: (_project: string, options: StreamOptions) => {
    opened.options = options;
    return { close: opened.close };
  },
}));

const Probe: React.FC<{ onChange: () => void }> = ({ onChange }) => {
  const state = useInstanceEvents('proj', 'pi-1', onChange);
  return <span>{state}</span>;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('useInstanceEvents', () => {
  it('reloads once per burst of the instance events and reports the stream state', () => {
    const onChange = vi.fn();
    const container = render(<Probe onChange={onChange} />);
    act(() => opened.options!.onState!('live'));
    expect(container.textContent).toBe('live');

    act(() => {
      opened.options!.onEvent({ seq: 1, eventType: 'TASK_CREATED', processInstanceId: 'pi-2' });
      opened.options!.onEvent({ seq: 2, eventType: 'TASK_CREATED', processInstanceId: 'pi-1' });
      opened.options!.onEvent({ seq: 3, eventType: 'AGENT_TOOL_STEP', processInstanceId: 'pi-1' });
    });
    act(() => { vi.advanceTimersByTime(350); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].seq).toBe(3);

    act(() => opened.options!.onState!('unavailable'));
    expect(container.textContent).toBe('unavailable');
  });
});
