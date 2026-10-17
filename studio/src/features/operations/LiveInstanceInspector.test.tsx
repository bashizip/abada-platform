import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttons, click, render } from '@/test/render';
import type { ProcessInstanceDTO } from '@/api/engine';
import type { AgentStepEvidence } from '@/api/evidence';
import type { WorkflowFile } from '@/types';
import { LiveInstanceInspector } from './LiveInstanceInspector';

const engine = vi.hoisted(() => ({
  getInstanceHistory: vi.fn(),
  getJobs: vi.fn(),
  getInstanceVariables: vi.fn(),
  retryJob: vi.fn(),
}));
const evidence = vi.hoisted(() => ({ steps: vi.fn(), payloads: vi.fn() }));
vi.mock('@/api/engine', async (original) => ({
  ...(await original<typeof import('@/api/engine')>()),
  EngineAPI: engine,
}));
vi.mock('@/api/evidence', async (original) => ({
  ...(await original<typeof import('@/api/evidence')>()),
  EvidenceAPI: evidence,
}));

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

const workflow = {
  id: 'wf', name: 'Refund desk', category: 'custom', fileType: 'apl', version: '1', updatedAt: '',
  edges: [],
  nodes: [
    {
      id: 'triage', type: 'agent', title: 'Triage', description: '', x: 0, y: 0,
      agentConfig: { model: 'gemini-3.6-flash', systemPrompt: '', confidenceThreshold: 0, temperature: 0.2, tools: [] },
    },
  ],
} as unknown as WorkflowFile;

const instance = {
  id: 'inst-1', processDefinitionId: 'refund_desk', startDate: '2026-10-12T10:00:00Z', status: 'RUNNING', variables: {},
} as ProcessInstanceDTO;

const step = (patch: Partial<AgentStepEvidence>): AgentStepEvidence => ({
  id: `s${patch.sequence}`, externalTaskId: 't1', activityId: 'triage', attempt: 1, sequence: 1,
  kind: 'MODEL_CALL', state: 'COMPLETED', costUnpriced: false, payloadMode: 'redacted',
  startedAt: '2026-10-12T10:00:00Z', ...patch,
});

const props = {
  instance, workflow, projectId: 'proj', selectedNodeId: 'triage' as string | null, onClose: () => undefined,
  panelWidth: 420, onPanelWidthChange: () => undefined, pinned: true, onPinnedChange: () => undefined,
};

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('live instance inspector', () => {
  it('lists the selected agent node\'s steps and opens a delegated child', async () => {
    engine.getInstanceHistory.mockResolvedValue([]);
    engine.getJobs.mockResolvedValue([]);
    engine.getInstanceVariables.mockResolvedValue({});
    evidence.steps.mockResolvedValue([
      step({ sequence: 1, model: 'gemini-3.6-flash', promptTokens: 100, completionTokens: 20, costUsd: 0.0012 }),
      step({ sequence: 2, kind: 'TOOL_CALL', toolRef: 'payments/refund', policy: 'approval_required', state: 'APPROVED',
        resolvedBy: 'fiona' }),
      step({ sequence: 3, kind: 'DELEGATION', toolRef: 'delegate:fraud_check', policy: 'delegate', state: 'STARTED',
        childInstanceId: 'child-123456789' }),
      step({ sequence: 4, activityId: 'other', toolRef: 'crm/notify', kind: 'TOOL_CALL', state: 'COMPLETED' }),
    ]);
    const open = vi.fn();
    const container = render(<LiveInstanceInspector {...props} onOpenInstance={open} />);
    await settle();

    expect(evidence.steps).toHaveBeenCalledWith('proj', 'inst-1');
    const text = container.textContent ?? '';
    expect(text).toContain('Steps (3)');
    expect(text).toContain('payments/refund');
    expect(text).toContain('approved by fiona');
    expect(text).toContain('$0.0012');
    // Another node's step is not shown on this node.
    expect(text).not.toContain('crm/notify');

    await act(async () => { click(buttons(container).find((button) => button.textContent?.includes('child child-12'))!); });
    expect(open).toHaveBeenCalledWith('child-123456789');
  });

  it('still shows the node when the steps cannot be read', async () => {
    engine.getInstanceHistory.mockResolvedValue([]);
    engine.getJobs.mockResolvedValue([]);
    engine.getInstanceVariables.mockResolvedValue({});
    evidence.steps.mockRejectedValue(new Error('403'));
    const container = render(<LiveInstanceInspector {...props} />);
    await settle();

    const text = container.textContent ?? '';
    expect(text).toContain('Agent configuration');
    expect(text).toContain('gemini-3.6-flash');
    expect(text).not.toContain('Steps (');
  });

  it('offers to retry a failed job only to members who may (operators and owners)', async () => {
    engine.getInstanceHistory.mockResolvedValue([]);
    engine.getJobs.mockResolvedValue([
      { id: 'job-1234567890ab', processInstanceId: 'inst-1', activityId: 'charge', exceptionMessage: 'provider timeout', retries: 0 },
    ]);
    const charging = { ...workflow, nodes: [{ id: 'charge', type: 'engine-task', title: 'Charge', description: '', x: 0, y: 0,
      engineTaskConfig: { service: 'charge-card' } }] } as unknown as WorkflowFile;
    const jobProps = { ...props, workflow: charging, selectedNodeId: 'charge' };
    engine.getInstanceVariables.mockResolvedValue({});
    evidence.steps.mockResolvedValue([]);
    engine.retryJob.mockResolvedValue(undefined);

    const viewer = render(<LiveInstanceInspector {...jobProps} />);
    await settle();
    expect(viewer.textContent).toContain('provider timeout');
    expect(buttons(viewer).some((item) => item.textContent?.trim() === 'Retry')).toBe(false);

    const operator = render(<LiveInstanceInspector {...jobProps} canRetryJobs />);
    await settle();
    const retry = buttons(operator).find((item) => item.textContent?.trim() === 'Retry');
    expect(retry).toBeDefined();
    click(retry!);
    await settle();
    expect(engine.retryJob).toHaveBeenCalledWith('proj', 'job-1234567890ab', 1);
  });
});
