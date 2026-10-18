import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessInstanceDTO } from '@/api/engine';
import { MotionProvider } from '@/components/ui';
import { buttons, click, render } from '@/test/render';
import { ProcessOperations } from './ProcessOperations';
import { resetOverviewMemory } from './overview/filters';

const api = vi.hoisted(() => ({
  getInstances: vi.fn(), getProcessDefinitions: vi.fn(), getIncidents: vi.fn(), getWorkerHealth: vi.fn(),
  getTaskPage: vi.fn(), getInstanceVariables: vi.fn(), cancelInstance: vi.fn(),
}));
vi.mock('@/api/engine', () => ({ EngineAPI: api }));
vi.mock('@/api/eventStream', () => ({
  openProjectStream: (_project: string, options: { onState?: (state: string) => void }) => {
    options.onState?.('live');
    return { close: () => undefined };
  },
}));

const NOW = Date.now();
const instance = (index: number, patch: Partial<ProcessInstanceDTO> = {}): ProcessInstanceDTO => ({
  id: `instance-${index}`, processDefinitionId: 'lead_triage', processDefinitionDeploymentId: 'dep-3', status: 'RUNNING',
  startDate: new Date(NOW - index * 600_000).toISOString(), currentActivityId: 'classify_lead',
  variables: { leadId: `L-${index}` }, ...patch,
} as ProcessInstanceDTO);

const page = (items: ProcessInstanceDTO[], total = items.length) => ({ items, page: 0, pageSize: items.length, total, totalPages: 1 });
const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });

function serve(rows: ProcessInstanceDTO[]) {
  api.getInstances.mockImplementation(async (_project: string, query: { status?: string; size?: number }) => {
    const matching = query.status ? rows.filter((row) => row.status === query.status) : rows;
    return page(matching.slice(0, query.size ?? 50), matching.length);
  });
}

beforeEach(() => {
  api.getProcessDefinitions.mockResolvedValue([
    { id: 'lead_triage', name: 'Lead triage', version: 3, deploymentId: 'dep-3' },
    { id: 'lead_triage', name: 'Lead triage', version: 2, deploymentId: 'dep-2' },
  ]);
  api.getIncidents.mockResolvedValue([]);
  api.getWorkerHealth.mockResolvedValue([]);
  api.getTaskPage.mockResolvedValue({ items: [], total: 4 });
});

afterEach(() => {
  vi.clearAllMocks();
  resetOverviewMemory();
  document.body.innerHTML = '';
});

const mount = (props: Partial<React.ComponentProps<typeof ProcessOperations>> = {}) =>
  render(<MotionProvider><ProcessOperations projectId="proj" {...props} /></MotionProvider>);

describe('Operations overview', () => {
  it('shows the headline figures, the list and the state counts from the existing endpoints', async () => {
    serve([instance(1), instance(2), instance(3, { status: 'COMPLETED', endDate: new Date(NOW - 60_000).toISOString() })]);
    const container = mount();
    await settle();
    expect(container.textContent).toContain('Running');
    expect(container.textContent).toContain('Waiting on you');
    expect(container.textContent).toContain('L-1');
    expect(container.textContent).toContain('Lead triage');
    expect(container.textContent).toContain('v3');
    const running = buttons(container).find((item) => item.getAttribute('aria-pressed') !== null && item.textContent?.startsWith('Running'));
    expect(running?.textContent).toContain('2');
    expect(api.getTaskPage).toHaveBeenCalledWith('proj', 'AVAILABLE');
    expect(container.textContent).toContain('Nothing needs attention');
  });

  it('filters by state on the server when a chip is chosen', async () => {
    serve([instance(1), instance(2, { status: 'COMPLETED' })]);
    const container = mount();
    await settle();
    const completed = buttons(container).find((item) => item.getAttribute('aria-pressed') !== null && item.textContent?.startsWith('Completed'));
    click(completed as HTMLButtonElement);
    await settle();
    expect(api.getInstances).toHaveBeenCalledWith('proj', expect.objectContaining({ status: 'COMPLETED', page: 0, size: 50 }));
    expect(container.textContent).not.toContain('L-1');
  });

  it('opens the instance under the cursor with Enter', async () => {
    serve([instance(1), instance(2)]);
    const onOpenDetail = vi.fn();
    mount({ onOpenDetail });
    await settle();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 'instance-2' }));
  });

  it('turns an open incident into a severity card that opens its step', async () => {
    serve([instance(1)]);
    api.getIncidents.mockResolvedValue([{ id: 'inc', projectId: 'proj', processInstanceId: 'instance-1', activityId: 'enrich_company',
      type: 'TOOL_OUTCOME_UNKNOWN', message: 'The ERP call was interrupted', createdAt: new Date(NOW - 60_000).toISOString() }]);
    const onOpenIncident = vi.fn();
    const container = mount({ onOpenIncident });
    await settle();
    expect(container.textContent).toContain('Needs a decision');
    expect(container.textContent).toContain('1 needs a decision');
    click(buttons(container).find((item) => item.textContent?.includes('Enrich Company')) as HTMLButtonElement);
    expect(onOpenIncident).toHaveBeenCalledWith(expect.objectContaining({ id: 'inc' }));
  });

  it('shows the empty project with a way to the designer', async () => {
    serve([]);
    api.getProcessDefinitions.mockResolvedValue([]);
    const onOpenDesigner = vi.fn();
    const container = mount({ onOpenDesigner });
    await settle();
    expect(container.textContent).toContain('No process has run in this project yet');
    click(buttons(container).find((item) => item.textContent === 'Open the designer') as HTMLButtonElement);
    expect(onOpenDesigner).toHaveBeenCalled();
  });

  it('asks before cancelling and cancels on confirmation', async () => {
    serve([instance(1)]);
    api.cancelInstance.mockResolvedValue(undefined);
    const container = mount({ canRetryIncidents: true });
    await settle();
    click(container.querySelector('[aria-label="Cancel"]') as HTMLButtonElement);
    await settle();
    expect(api.cancelInstance).not.toHaveBeenCalled();
    click(buttons(document.body).find((item) => item.textContent === 'Cancel instance') as HTMLButtonElement);
    await settle();
    expect(api.cancelInstance).toHaveBeenCalledWith('instance-1', 'proj');
  });
});

describe('Operations overview memory', () => {
  afterEach(() => {
    vi.clearAllMocks();
    resetOverviewMemory();
    document.body.innerHTML = '';
  });

  it('puts the cursor back on the instance the user opened', async () => {
    serve([instance(1), instance(2), instance(3)]);
    const onOpenDetail = vi.fn();
    mount({ onOpenDetail });
    await settle();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); });
    document.body.innerHTML = '';
    const again = mount({ onOpenDetail });
    await settle();
    expect(again.querySelector('[aria-current="true"]')?.textContent).toContain('L-3');
  });
});
