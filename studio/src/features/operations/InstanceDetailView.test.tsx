import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessInstanceDTO } from '@/api/engine';
import { MotionProvider } from '@/components/ui';
import { buttons, click, render } from '@/test/render';
import { InstanceDetailView } from './InstanceDetailView';

const api = vi.hoisted(() => ({
  getInstance: vi.fn(), getActivityInstances: vi.fn(), getInstanceHistory: vi.fn(), getDefinitionForInstance: vi.fn(),
  getInstanceVariables: vi.fn(), getJobs: vi.fn(), getIncidents: vi.fn(), getLineage: vi.fn(), getVersions: vi.fn(),
  setInstanceSuspension: vi.fn(),
}));
vi.mock('@/api/engine', () => ({ EngineAPI: api }));
vi.mock('@/api/evidence', () => ({ EvidenceAPI: { steps: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/api/eventStream', () => ({
  openProjectStream: (_project: string, options: { onState?: (state: string) => void }) => {
    options.onState?.('live');
    return { close: () => undefined };
  },
}));

const instance: ProcessInstanceDTO = {
  id: 'instance-1', processDefinitionId: 'lead_triage', processDefinitionName: 'Lead triage', status: 'RUNNING',
  startDate: new Date(Date.now() - 65_000).toISOString(), startedBy: 'alice', variables: { leadId: 'L-42' },
} as ProcessInstanceDTO;

const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
const escape = () => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });

beforeEach(() => {
  // jsdom does not scroll; the audit trail follows its newest entry.
  Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo'];
  api.getInstance.mockResolvedValue(instance);
  api.getActivityInstances.mockResolvedValue([]);
  api.getInstanceHistory.mockResolvedValue([]);
  api.getDefinitionForInstance.mockResolvedValue({ id: 'lead_triage', name: 'Lead triage', version: 3, deploymentId: 'd3', schemaType: 'BPMN' });
  api.getInstanceVariables.mockResolvedValue({ leadId: 'L-42', score: 0.82 });
  api.getJobs.mockResolvedValue([]);
  api.getIncidents.mockResolvedValue([]);
  api.getLineage.mockResolvedValue({ ancestors: [], children: [], depth: 0 });
  api.getVersions.mockResolvedValue([]);
  api.setInstanceSuspension.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

const mount = (props: Partial<React.ComponentProps<typeof InstanceDetailView>> = {}) => render(
  <MotionProvider>
    <InstanceDetailView instanceId="instance-1" projectId="proj" initialInstance={instance}
      onBack={() => undefined} onOpenCanvas={() => undefined} {...props} />
  </MotionProvider>,
);

describe('instance view', () => {
  it('shows state, version, who started it and the elapsed time in the header', async () => {
    const container = mount();
    await settle();
    const header = container.querySelector('header') as HTMLElement;
    expect(header.textContent).toContain('L-42');
    expect(header.textContent).toContain('Running');
    expect(header.textContent).toContain('v3');
    expect(header.textContent).toContain('alice');
    expect(header.textContent).toMatch(/1m \d+s/);
  });

  it('offers Suspend and Cancel to operators only', async () => {
    const viewer = mount();
    await settle();
    expect(buttons(viewer).some((item) => item.textContent?.includes('Suspend'))).toBe(false);
    expect(buttons(viewer).some((item) => item.textContent?.includes('Cancel'))).toBe(false);
    document.body.innerHTML = '';
    const operator = mount({ canRetryIncidents: true });
    await settle();
    click(buttons(operator).find((item) => item.textContent?.includes('Suspend')) as HTMLButtonElement);
    await settle();
    expect(api.setInstanceSuspension).toHaveBeenCalledWith('instance-1', 'proj', true);
  });

  it('opens the details drawer from its tabs and closes it with Esc before going back', async () => {
    const onBack = vi.fn();
    const container = mount({ onBack });
    await settle();
    const tab = (name: string) => [...container.querySelectorAll('[role="tab"]')].find((item) => item.textContent?.startsWith(name)) as HTMLElement;
    click(tab('Variables'));
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('score');
    expect(tab('Variables').getAttribute('aria-selected')).toBe('true');
    click(tab('Lineage'));
    await settle();
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('has called none');
    escape();
    expect(onBack).not.toHaveBeenCalled();
    expect(tab('Lineage').getAttribute('aria-selected')).toBe('false');
    escape();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
