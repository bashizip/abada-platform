import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttons, click, render } from '@/test/render';
import { LineagePanel } from './LineagePanel';

const api = vi.hoisted(() => ({ getLineage: vi.fn() }));
vi.mock('@/api/engine', () => ({ EngineAPI: api }));

const settle = () => act(async () => { await Promise.resolve(); });

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('lineage panel', () => {
  it('shows the callers and the called processes and opens them', async () => {
    api.getLineage.mockResolvedValue({
      instanceId: 'mid', rootInstanceId: 'root', depth: 1,
      ancestors: [{ instanceId: 'root', processDefinitionId: 'outer_case', status: 'RUNNING' }],
      children: [{ instanceId: 'kid', processDefinitionId: 'fraud_check', status: 'COMPLETED', parentActivityId: 'fraud_check' }],
    });
    const open = vi.fn();
    const container = render(<LineagePanel projectId="proj" instanceId="mid" onOpenInstance={open} />);
    await settle();

    expect(api.getLineage).toHaveBeenCalledWith('proj', 'mid');
    expect(container.textContent).toContain('Called by');
    expect(container.textContent).toContain('Outer Case');
    expect(container.textContent).toContain('this instance (depth 1)');
    expect(container.textContent).toContain('Called processes (1)');
    expect(container.textContent).toContain('COMPLETED');
    await act(async () => { click(buttons(container).find((button) => button.textContent === 'Fraud Check')!); });
    expect(open).toHaveBeenCalledWith('kid');
  });

  it('stays hidden for an instance outside any call tree', async () => {
    api.getLineage.mockResolvedValue({ instanceId: 'solo', rootInstanceId: 'solo', depth: 0, ancestors: [], children: [] });
    const container = render(<LineagePanel projectId="proj" instanceId="solo" />);
    await settle();
    expect(container.textContent).toBe('');
  });
});
