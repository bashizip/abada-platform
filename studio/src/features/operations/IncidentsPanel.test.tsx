import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncidentDTO } from '@/api/engine';
import { setAplContract } from '@/lib/aplContract';
import { buttons, byLabel, click, render, type } from '@/test/render';
import { IncidentsPanel } from './IncidentsPanel';

const api = vi.hoisted(() => ({ getIncidents: vi.fn(), retryIncident: vi.fn() }));
vi.mock('@/api/engine', () => ({ EngineAPI: api }));

const incident = (patch: Partial<IncidentDTO>): IncidentDTO => ({
  id: 'inc-1', projectId: 'proj', processInstanceId: 'instance-1', activityId: 'draft_reply', type: 'WORK_FAILED',
  message: 'Agent work failed after 3 attempts: provider timeout', createdAt: '2026-10-01T10:00:00Z', ...patch,
});

const settle = () => act(async () => { await Promise.resolve(); });
const button = (container: Element, label: string) =>
  buttons(container).find((item) => item.textContent?.trim() === label);

beforeEach(() => {
  setAplContract({ allowedAgentModels: ['model-a', 'model-b', 'model-c'], scriptsEnabled: false, agentBounds: {}, hitPolicies: [] });
  api.retryIncident.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  setAplContract(null);
});

describe('incidents panel', () => {
  it('lists open incidents with kind, step, time and message, without actions for viewers', async () => {
    api.getIncidents.mockResolvedValue([
      incident({}),
      incident({ id: 'inc-2', type: 'LOOP_EXHAUSTED', activityId: 'revise', message: 'Loop reached 3 iterations' }),
    ]);
    const container = render(<IncidentsPanel projectId="proj" canRetry={false} modelFor={() => 'model-a'} />);
    await settle();

    expect(api.getIncidents).toHaveBeenCalledWith('proj');
    expect(container.textContent).toContain('2 open');
    expect(container.textContent).toContain('Work failed');
    expect(container.textContent).toContain('Draft Reply');
    expect(container.textContent).toContain('provider timeout');
    expect(container.textContent).toContain('Loop exhausted');
    expect(container.textContent).toContain('Loop reached 3 iterations');
    expect(button(container, 'Retry')).toBeUndefined();
    expect(button(container, 'Retry on another model')).toBeUndefined();
  });

  it('shows only the instance\'s incidents on the detail view and hides when there are none', async () => {
    api.getIncidents.mockResolvedValue([incident({ processInstanceId: 'other' })]);
    const container = render(<IncidentsPanel projectId="proj" instanceId="instance-1" canRetry hideWhenEmpty />);
    await settle();
    expect(container.textContent).toBe('');
  });

  it('retries an incident and drops it from the list', async () => {
    const onRetried = vi.fn();
    api.getIncidents.mockResolvedValueOnce([incident({ type: 'LOOP_EXHAUSTED' })]).mockResolvedValue([]);
    const container = render(
      <IncidentsPanel projectId="proj" canRetry modelFor={() => 'model-a'} onRetried={onRetried} />,
    );
    await settle();

    expect(button(container, 'Retry on another model')).toBeUndefined();
    click(button(container, 'Retry')!);
    await settle();

    expect(api.retryIncident).toHaveBeenCalledWith('proj', 'inc-1', undefined);
    expect(onRetried).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('none open');
  });

  it('retries failed agent work on another allowed model with a required reason', async () => {
    api.getIncidents.mockResolvedValue([incident({})]);
    const container = render(<IncidentsPanel projectId="proj" canRetry modelFor={() => 'model-a'} />);
    await settle();

    click(button(container, 'Retry on another model')!);
    const select = container.querySelector('#incident-inc-1-model') as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(['model-b', 'model-c']);

    type(select, 'model-c');
    const submit = button(container, 'Retry on model-c')!;
    expect(submit.disabled).toBe(true);

    type(container.querySelector('#incident-inc-1-reason') as HTMLInputElement, '  provider outage  ');
    expect(submit.disabled).toBe(false);
    click(submit);
    await settle();

    expect(api.retryIncident).toHaveBeenCalledWith('proj', 'inc-1', { model: 'model-c', reason: 'provider outage' });
  });

  it('does not offer another model for failed work outside an agent step', async () => {
    api.getIncidents.mockResolvedValue([incident({})]);
    const container = render(<IncidentsPanel projectId="proj" canRetry modelFor={() => null} />);
    await settle();
    expect(button(container, 'Retry')).toBeDefined();
    expect(button(container, 'Retry on another model')).toBeUndefined();
  });

  it('keeps the incident and shows the engine\'s reason when a retry is refused', async () => {
    api.getIncidents.mockResolvedValue([incident({})]);
    api.retryIncident.mockRejectedValue(new Error('403 Project role OPERATOR required'));
    const container = render(<IncidentsPanel projectId="proj" canRetry modelFor={() => null} />);
    await settle();

    click(button(container, 'Retry')!);
    await settle();

    expect(byLabel(container, 'Incident inc-1')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('403 Project role OPERATOR required');
  });
});
