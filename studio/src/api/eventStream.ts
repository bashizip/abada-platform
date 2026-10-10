import { config } from '@/config/runtime';
import { authenticatedFetch } from '@/api/authenticatedFetch';

/**
 * The project event stream (`GET /v1/projects/{id}/events/stream`, SSE).
 * Read with fetch rather than EventSource, which cannot send the Bearer
 * token. Events carry ids only; a page reloads what it shows when one
 * concerns it. Reconnects resume with `Last-Event-ID`.
 */
export interface ProjectEvent {
  seq: number;
  eventType: string;
  processInstanceId?: string;
  activityId?: string;
  occurredAt?: string;
}

export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'unavailable';

export interface SseFrame {
  id?: string;
  event?: string;
  data?: string;
}

/** Splits complete frames off the buffer; the unfinished tail is returned as `rest`. */
export function parseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n?/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const block of blocks) {
    const frame: SseFrame = {};
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue; // comments are heartbeats
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id') frame.id = value;
      else if (field === 'event') frame.event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) frame.data = data.join('\n');
    if (frame.id !== undefined || frame.data !== undefined) frames.push(frame);
  }
  return { frames, rest };
}

export interface StreamOptions {
  onEvent: (event: ProjectEvent) => void;
  onState?: (state: StreamState) => void;
  /** The resume point was too old: reload everything shown. */
  onReset?: () => void;
  /** Failed attempts before the state is `unavailable` (polling takes over); retries continue. */
  maxFailures?: number;
  backoffMs?: (attempt: number) => number;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}

const defaultBackoff = (attempt: number) => Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));

export function openProjectStream(projectId: string, options: StreamOptions): { close: () => void } {
  const fetchImpl = options.fetchImpl ?? authenticatedFetch;
  const maxFailures = options.maxFailures ?? 3;
  const backoff = options.backoffMs ?? defaultBackoff;
  const controller = new AbortController();
  let closed = false;
  let lastEventId: string | undefined;
  let failures = 0;
  const setState = (state: StreamState) => { if (!closed) options.onState?.(state); };

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

  const run = async () => {
    setState('connecting');
    while (!closed) {
      let permanent = false;
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream, application/json' };
        if (lastEventId) headers['Last-Event-ID'] = lastEventId;
        const response = await fetchImpl(`${config.apiUrl}/v1/projects/${encodeURIComponent(projectId)}/events/stream`,
          { headers, signal: controller.signal });
        if (!response.ok || !response.body) {
          // Not a member or no such project: the stream will not appear by retrying.
          permanent = response.status === 403 || response.status === 404;
          throw new Error(`stream refused (${response.status})`);
        }
        failures = 0;
        setState('live');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseFrames(buffer);
          buffer = parsed.rest;
          for (const frame of parsed.frames) {
            if (frame.id) lastEventId = frame.id;
            if (frame.event === 'reset') { options.onReset?.(); continue; }
            if (!frame.data) continue;
            try {
              options.onEvent(JSON.parse(frame.data) as ProjectEvent);
            } catch {
              // A frame that is not JSON is not an event of this stream.
            }
          }
        }
        // The server ended the stream (timeout, rolling restart): resume at once.
      } catch {
        if (closed) return;
        failures += 1;
        if (permanent) {
          setState('unavailable');
          return;
        }
        setState(failures >= maxFailures ? 'unavailable' : 'reconnecting');
        await sleep(backoff(failures));
      }
    }
  };
  void run();
  return {
    close: () => {
      closed = true;
      controller.abort();
    },
  };
}
