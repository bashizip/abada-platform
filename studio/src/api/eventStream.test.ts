import { describe, expect, it, vi } from 'vitest';
import { openProjectStream, parseFrames, type ProjectEvent, type StreamState } from './eventStream';

vi.mock('@/api/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));

const encoder = new TextEncoder();

/** A response whose body yields the chunks, then ends (or stays open). */
function streamed(chunks: string[], keepOpen = false): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      if (!keepOpen) controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const refused = (status: number) => ({ ok: false, status, body: null }) as unknown as Response;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SSE frames', () => {
  it('parses id, event and data, skips heartbeats and keeps an unfinished tail', () => {
    const { frames, rest } = parseFrames(': heartbeat\n\nid: 7\nevent: TASK_CREATED\ndata: {"seq":7}\n\nid: 8\ndata: {"se');
    expect(frames).toEqual([{ id: '7', event: 'TASK_CREATED', data: '{"seq":7}' }]);
    expect(rest).toBe('id: 8\ndata: {"se');
  });
});

describe('project event stream', () => {
  it('delivers events, then resumes after the last id when the server ends the stream', async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      return calls.length === 1
        ? streamed(['id: 7\nevent: PROCESS_STARTED\ndata: {"seq":7,"eventType":"PROCESS_STARTED",',
          '"processInstanceId":"pi-1"}\n\n'])
        : streamed(['id: 9\nevent: TASK_CREATED\ndata: {"seq":9,"eventType":"TASK_CREATED"}\n\n'], true);
    });
    const events: ProjectEvent[] = [];
    const states: StreamState[] = [];
    const stream = openProjectStream('proj', { fetchImpl, onEvent: (event) => events.push(event),
      onState: (state) => states.push(state) });
    await vi.waitFor(() => expect(events).toHaveLength(2));
    stream.close();

    expect(events.map((event) => event.seq)).toEqual([7, 9]);
    expect(events[0].processInstanceId).toBe('pi-1');
    expect((calls[1].headers as Record<string, string>)['Last-Event-ID']).toBe('7');
    expect(states).toContain('live');
  });

  it('falls back to polling after repeated failures and keeps retrying', async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts <= 3) throw new Error('network down');
      return streamed([], true);
    });
    const states: StreamState[] = [];
    const stream = openProjectStream('proj', { fetchImpl, onEvent: () => undefined, backoffMs: () => 1,
      onState: (state) => states.push(state) });
    await vi.waitFor(() => expect(states).toContain('live'));
    stream.close();
    expect(states).toEqual(['connecting', 'reconnecting', 'reconnecting', 'unavailable', 'live']);
  });

  it('stops for good when the project refuses the stream', async () => {
    const fetchImpl = vi.fn(async () => refused(404));
    const states: StreamState[] = [];
    openProjectStream('proj', { fetchImpl, onEvent: () => undefined, onState: (state) => states.push(state) });
    await vi.waitFor(() => expect(states).toContain('unavailable'));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('tells the page to reload when its resume point is too old', async () => {
    const onReset = vi.fn();
    const stream = openProjectStream('proj', { fetchImpl: async () => streamed(['id: 50\nevent: reset\ndata: {"seq":50}\n\n'], true),
      onEvent: () => undefined, onReset });
    await vi.waitFor(() => expect(onReset).toHaveBeenCalled());
    stream.close();
  });
});
