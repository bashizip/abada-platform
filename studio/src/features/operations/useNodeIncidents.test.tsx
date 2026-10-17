import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityHistoryDTO, ActivityInstanceDTO, FlowTakenDTO, IncidentDTO } from '@/api/engine';
import type { WorkflowFile, WorkflowNode } from '@/types';
import { useNodeIncidents, type NodeIncidents } from './useNodeIncidents';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = (id: string, type: WorkflowNode['type']): WorkflowNode => ({ id, type, title: id, description: '', x: 0, y: 0 });
const workflow: WorkflowFile = {
  id: 'p', name: 'p', category: 'custom', fileType: 'apl', version: '1', updatedAt: '2026-10-17T00:00:00Z',
  nodes: [node('charge', 'engine-task'), node('notify', 'engine-task')], edges: [],
};
const incident = (id: string, activityId = 'charge'): IncidentDTO => ({
  id, projectId: 'proj', processInstanceId: 'instance', activityId, type: 'WORK_FAILED', createdAt: '2026-10-17T10:00:00Z',
});
let sequence = 0;
const event = (eventType: string, activityId: string, details: Record<string, unknown> = {}): ActivityHistoryDTO => ({
  id: `h${++sequence}`, processInstanceId: 'instance', processDefinitionId: 'p', activityId, eventType, actor: 'system',
  occurredAt: '2026-10-17T10:00:00Z', details,
});
const flow = (from: string, to: string): ActivityHistoryDTO => {
  const taken: FlowTakenDTO = { id: `Flow_${from}_${to}`, from, to, tokenId: 't' };
  return { ...event('FLOW_TAKEN', from, { flow: taken }), flow: taken };
};

interface Props {
  incidents: IncidentDTO[];
  history: ActivityHistoryDTO[];
  visible?: ActivityHistoryDTO[];
  activities?: ActivityInstanceDTO[];
  focus?: string;
  onResolved?: (nodeId: string, historyId?: string) => void;
}
let latest: NodeIncidents;
const Probe: React.FC<Props> = ({ incidents, history, visible, activities = [], focus, onResolved }) => {
  latest = useNodeIncidents({
    workflow, incidents, incidentsLoaded: true, visibleHistory: visible ?? history, history, historyLoaded: true,
    activities, dwellMs: 700, initialFocusNodeId: focus, onResolved,
  });
  return null;
};
let root: Root;
const show = (props: Props) => act(() => { root.render(<Probe {...props} />); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('incidents on the instance diagram', () => {
  const failed = event('EXTERNAL_TASK_FAILED', 'charge', { retries: 0, externalTaskId: 'job' });
  const opening = [event('PROCESS_STARTED', 'start'), flow('start', 'charge'), failed];

  it('marks the failing node, focuses it and opens its card when the view opens', () => {
    show({ incidents: [incident('inc-1')], history: opening });
    expect(latest.incidentNodeIds).toEqual(['charge']);
    expect(latest.incidentPulses).toEqual({ charge: 'inc-1' });
    expect(latest.focus?.nodeId).toBe('charge');
    expect(latest.cardNodeId).toBe('charge');
  });

  it('focuses the step it was opened for, and each new incident as it arrives', () => {
    show({ incidents: [incident('inc-1'), incident('inc-2', 'notify')], history: opening, focus: 'notify' });
    expect(latest.cardNodeId).toBe('notify');
    const first = latest.focus?.key;
    show({ incidents: [incident('inc-3'), incident('inc-1'), incident('inc-2', 'notify')], history: opening, focus: 'notify' });
    expect(latest.focus?.nodeId).toBe('charge');
    expect(latest.focus?.key).not.toBe(first);
  });

  it('plays a retry through its phases as the playback shows them, then announces and settles', () => {
    const onResolved = vi.fn();
    show({ incidents: [incident('inc-1')], history: opening, onResolved });
    act(() => latest.retried(incident('inc-1')));
    // Committed, not fetched yet: retrying, and the node leaves the incident state.
    show({ incidents: [], history: opening, onResolved });
    expect(latest.retryPhases).toEqual({ charge: 'retrying' });
    expect(latest.incidentNodeIds).toEqual([]);

    const retried = event('INCIDENT_RETRIED', 'charge', { incidentId: 'inc-1' });
    const locked = event('EXTERNAL_TASK_LOCKED', 'charge');
    const done = event('EXTERNAL_TASK_COMPLETED', 'charge');
    const all = [...opening, retried, locked, done, flow('charge', 'notify')];
    // The engine is done; the playback still shows the retry row only.
    show({ incidents: [], history: all, visible: [...opening, retried], onResolved });
    expect(latest.retryPhases).toEqual({ charge: 'retrying' });
    show({ incidents: [], history: all, visible: [...opening, retried, locked], onResolved });
    expect(latest.retryPhases).toEqual({ charge: 'active' });
    expect(onResolved).not.toHaveBeenCalled();
    show({ incidents: [], history: all, visible: [...opening, retried, locked, done], onResolved });
    expect(latest.retryPhases).toEqual({ charge: 'completed' });
    expect(onResolved).toHaveBeenCalledWith('charge', retried.id);
    advance(700);
    expect(latest.retryPhases).toEqual({});
    expect(latest.cardNodeId).toBeNull();
  });

  it('keeps a new incident off the node until the failed retry is on screen', () => {
    show({ incidents: [incident('inc-1')], history: opening });
    act(() => latest.retried(incident('inc-1')));
    const retried = event('INCIDENT_RETRIED', 'charge', { incidentId: 'inc-1' });
    const locked = event('EXTERNAL_TASK_LOCKED', 'charge');
    const again = event('EXTERNAL_TASK_FAILED', 'charge', { retries: 0 });
    const all = [...opening, retried, locked, again];
    show({ incidents: [incident('inc-2')], history: all, visible: [...opening, retried, locked] });
    expect(latest.incidentNodeIds).toEqual([]);
    expect(latest.retryPhases).toEqual({ charge: 'active' });
    show({ incidents: [incident('inc-2')], history: all });
    expect(latest.retryPhases).toEqual({ charge: 'failed' });
    expect(latest.incidentNodeIds).toEqual(['charge']);
    advance(700);
    expect(latest.retryPhases).toEqual({});
    expect(latest.incidentPulses).toEqual({ charge: 'inc-2' });
    expect(latest.cardNodeId).toBe('charge');
  });
});
