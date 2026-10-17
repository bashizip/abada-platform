import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityHistoryDTO, IncidentDTO } from '@/api/engine';
import type { WorkflowNode } from '@/types';
import { setAplContract } from '@/lib/aplContract';
import { buttons, click, render, type } from '@/test/render';
import { NodeIncidentCard, RetryProgress } from './NodeIncidentCard';

const api = vi.hoisted(() => ({ retryIncident: vi.fn() }));
vi.mock('@/api/engine', () => ({ EngineAPI: api }));

const node = (id: string, type: WorkflowNode['type'], subtype?: WorkflowNode['subtype']): WorkflowNode => ({
  id, type, subtype, title: `The ${id} step`, description: '', x: 0, y: 0,
});
const incident = (activityId: string, type: string): IncidentDTO => ({
  id: `inc-${activityId}`, projectId: 'proj', processInstanceId: 'instance', activityId, type,
  message: `work at '${activityId}' failed: boom`, createdAt: '2026-10-17T10:00:00Z',
});
let sequence = 0;
const event = (eventType: string, activityId: string, details: Record<string, unknown> = {}): ActivityHistoryDTO => ({
  id: `h${++sequence}`, processInstanceId: 'instance', processDefinitionId: 'p', activityId, eventType, actor: 'system',
  occurredAt: '2026-10-17T10:00:00Z', details,
});
const failedJob = (activityId: string, retries: number) =>
  event('EXTERNAL_TASK_FAILED', activityId, { externalTaskId: `job-${activityId}`, retries });

const settle = () => act(async () => { await Promise.resolve(); });
const labels = (container: Element) => buttons(container).map((item) => item.textContent?.trim()).filter(Boolean);
const button = (container: Element, label: string) => buttons(container).find((item) => item.textContent?.trim() === label);

interface Case {
  name: string;
  node: WorkflowNode;
  incident: IncidentDTO;
  history: ActivityHistoryDTO[];
  model: string | null;
  operator: string[];
  viewer: string[];
}

const cases: Case[] = [
  {
    name: 'agent, failed work',
    node: node('draft', 'agent'), incident: incident('draft', 'WORK_FAILED'),
    history: [failedJob('draft', 2), failedJob('draft', 1), failedJob('draft', 0)], model: 'model-a',
    operator: ['Retry on another model', 'Retry', 'View details', 'Cancel instance'], viewer: ['View details'],
  },
  {
    name: 'engine task, failed work',
    node: node('charge', 'engine-task'), incident: incident('charge', 'WORK_FAILED'),
    history: [failedJob('charge', 0)], model: null,
    operator: ['Retry', 'View details', 'Cancel instance'], viewer: ['View details'],
  },
  {
    name: 'human task, failed',
    node: node('review', 'human'), incident: incident('review', 'WORK_FAILED'),
    history: [event('TASK_FAILED', 'review')], model: null,
    operator: ['Retry', 'Cancel instance'], viewer: [],
  },
  {
    name: 'loop step, exhausted',
    node: node('revise', 'engine-task'), incident: incident('revise', 'LOOP_EXHAUSTED'),
    history: [event('LOOP_EXHAUSTED', 'revise')], model: null,
    operator: ['Retry', 'Cancel instance'], viewer: [],
  },
  {
    name: 'message wait, missing correlation key',
    node: node('await_reply', 'event', 'message'), incident: incident('await_reply', 'MISSING_CORRELATION_KEY'),
    history: [], model: null,
    operator: ['Retry', 'Cancel instance'], viewer: [],
  },
  {
    name: 'call, child failed',
    node: node('kyc', 'call-process'), incident: incident('kyc', 'CHILD_FAILED'),
    history: [event('CHILD_FAILED', 'kyc')], model: null,
    operator: ['Retry', 'Cancel instance'], viewer: [],
  },
  {
    name: 'agent, write outcome unknown',
    node: node('refund', 'agent'), incident: incident('refund', 'TOOL_OUTCOME_UNKNOWN'),
    history: [], model: 'model-a',
    operator: ['It happened', 'It did not happen', 'Cancel instance'], viewer: [],
  },
];

const show = (item: Case, canAct: boolean, handlers: Partial<React.ComponentProps<typeof NodeIncidentCard>> = {}) => render(
  <NodeIncidentCard
    projectId="proj"
    incident={item.incident}
    node={item.node}
    history={item.history}
    canAct={canAct}
    model={item.model}
    onRetried={vi.fn()}
    onViewDetails={vi.fn()}
    onCancelInstance={vi.fn()}
    onClose={vi.fn()}
    {...handlers}
  />,
);

beforeEach(() => {
  setAplContract({ allowedAgentModels: ['model-a', 'model-b'], scriptsEnabled: false, agentBounds: {}, hitPolicies: [] });
  api.retryIncident.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  setAplContract(null);
});

describe('incident card on the node', () => {
  describe.each(cases)('$name', (item) => {
    it('offers an operator or owner every action the incident allows', () => {
      const container = show(item, true);
      expect(labels(container).filter((label) => label !== 'Show the whole message' && !label.startsWith('work at')))
        .toEqual(item.operator);
      expect(container.textContent).toContain(item.node.title);
    });

    it('shows a viewer the facts, never a mutation', () => {
      const container = show(item, false);
      expect(labels(container).filter((label) => !label.startsWith('work at'))).toEqual(item.viewer);
      expect(container.textContent).toContain('A project operator or owner can retry this step');
    });
  });

  it('says what failed: kind, attempts, model and message', () => {
    const container = show(cases[0], true);
    expect(container.textContent).toContain('Work failed');
    expect(container.textContent).toContain('3 failed attempts');
    expect(container.textContent).toContain('model-a');
    expect(container.textContent).toContain("work at 'draft' failed: boom");
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Incident on The draft step');
  });

  it('retries through the existing command and reports it', async () => {
    const onRetried = vi.fn();
    const container = show(cases[1], true, { onRetried });
    click(button(container, 'Retry')!);
    await settle();
    expect(api.retryIncident).toHaveBeenCalledWith('proj', 'inc-charge', undefined);
    expect(onRetried).toHaveBeenCalledWith(cases[1].incident);
  });

  it('shows the engine refusal and keeps the card when the retry is rejected', async () => {
    api.retryIncident.mockRejectedValue(new Error('Forbidden'));
    const onRetried = vi.fn();
    const container = show(cases[1], true, { onRetried });
    click(button(container, 'Retry')!);
    await settle();
    expect(onRetried).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Retry failed: Forbidden');
  });

  it('retries failed agent work on another allowed model only with a reason', async () => {
    const container = show(cases[0], true);
    click(button(container, 'Retry on another model')!);
    const submit = button(container, 'Retry on model-b')!;
    expect(submit.disabled).toBe(true);
    type(container.querySelector('#incident-inc-draft-reason') as HTMLInputElement, 'provider outage');
    click(submit);
    await settle();
    expect(api.retryIncident).toHaveBeenCalledWith('proj', 'inc-draft', { model: 'model-b', reason: 'provider outage' });
  });

  it('confirms an interrupted write instead of re-sending it', async () => {
    const container = show(cases[6], true);
    click(button(container, 'It did not happen')!);
    await settle();
    expect(api.retryIncident).toHaveBeenCalledWith('proj', 'inc-refund', { toolOutcome: 'NOT_PERFORMED' });
  });

  it('opens the details of the last failed job and asks the view to cancel', () => {
    const onViewDetails = vi.fn();
    const onCancelInstance = vi.fn();
    const container = show(cases[0], true, { onViewDetails, onCancelInstance });
    click(button(container, 'View details')!);
    expect(onViewDetails).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-draft' }));
    click(button(container, 'Cancel instance')!);
    expect(onCancelInstance).toHaveBeenCalledTimes(1);
    expect(api.retryIncident).not.toHaveBeenCalled();
  });

  it('becomes the retry progress while the retry plays out', () => {
    const container = render(<RetryProgress node={cases[1].node} phase="active" />);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Running again');
    const done = render(<RetryProgress node={cases[1].node} phase="completed" />);
    expect(done.textContent).toContain('Completed');
  });
});
