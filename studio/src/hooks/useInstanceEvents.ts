import { useEffect, useRef, useState } from 'react';
import { openProjectStream, type ProjectEvent, type StreamState } from '@/api/eventStream';

/**
 * Calls `onChange` (debounced) whenever the project event stream reports an
 * event of `instanceId`, or of any instance when it is omitted. Returns the
 * stream state: while it is not `live`, callers keep polling.
 */
export function useInstanceEvents(projectId: string | undefined, instanceId: string | undefined,
  onChange: (event?: ProjectEvent) => void, debounceMs = 300): StreamState {
  const [state, setState] = useState<StreamState>('connecting');
  const callback = useRef(onChange);
  useEffect(() => { callback.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!projectId) {
      setState('unavailable');
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest: ProjectEvent | undefined;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => callback.current(latest), debounceMs);
    };
    const stream = openProjectStream(projectId, {
      onState: setState,
      onReset: fire,
      onEvent: (event) => {
        if (instanceId && event.processInstanceId !== instanceId) return;
        latest = event;
        fire();
      },
    });
    return () => {
      if (timer) clearTimeout(timer);
      stream.close();
    };
  }, [projectId, instanceId, debounceMs]);

  return state;
}
