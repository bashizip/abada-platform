import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PropertiesInspector } from './PropertiesInspector';
import { ToastProvider } from './ToastContext';
import { byLabel, click, render, type } from '@/test/render';
import type { AplValidationIssue } from '@/api/apl';
import type { WorkflowFile, WorkflowNode } from '@/types';
import { NODE_KINDS, createNode } from '@/features/designer/nodes/nodeCatalog';

const base = { description: '', x: 0, y: 0 };
const agent: WorkflowNode = { ...base, id: 'draft', type: 'agent', title: 'Draft',
  agentConfig: { model: 'gemini-3.6-flash', systemPrompt: '', confidenceThreshold: 0, temperature: 0.2, tools: [] } };
const task: WorkflowNode = { ...base, id: 'sync', type: 'engine-task', title: 'Sync', engineTaskConfig: { service: 'crm' } };
const workflow = { nodes: [agent, task], edges: [] } as unknown as WorkflowFile;

const show = (node: WorkflowNode | null, extra: { issues?: AplValidationIssue[]; onUpdateNode?: (node: WorkflowNode) => void } = {}) => render(
  <ToastProvider>
    <PropertiesInspector selectedNode={node} onUpdateNode={extra.onUpdateNode ?? vi.fn()} onUpdateWorkflow={vi.fn()}
      workflow={workflow} nodeCount={2} issues={extra.issues} />
  </ToastProvider>,
);

describe('properties inspector', () => {
  it('names the node by its kind, drawn as on the canvas, with its APL type', () => {
    const container = show(task);
    expect(container.querySelector('h2')?.textContent).toBe('Engine task');
    expect(container.querySelector('header [data-shape="task"]')).not.toBeNull();
    expect(container.querySelector('header')?.textContent).toContain('engine-task');
  });

  it('gives engine tasks their own section: topic, error routes and timeout', () => {
    const container = show(task);
    expect(byLabel<HTMLInputElement>(container, 'Service topic').value).toBe('crm');
    expect(container.querySelector('[aria-label="Timeout duration"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Route for any error"]')).not.toBeNull();
  });

  it('edits agent routes, timeout and fallback models instead of pointing to APL', () => {
    const container = show(agent);
    expect(container.textContent).not.toContain('edit in APL');
    expect(container.querySelector('[aria-label="Low confidence (on_low_confidence)"]')).not.toBeNull();
    expect(container.textContent).toContain('Fallback models');
    expect(container.textContent).toContain('Repeat limit');
  });

  it('opens an editor for every kind in the palette', () => {
    for (const spec of NODE_KINDS) {
      const node = createNode(spec.kind, `n_${spec.kind.replace(/-/g, '_')}`, { x: 0, y: 0 });
      const container = show(node);
      expect(container.querySelector('h2')?.textContent, spec.kind).toBe(spec.label);
      expect(container.querySelectorAll('section[data-section], [role="status"], .rounded-lg').length, spec.kind)
        .toBeGreaterThan(0);
    }
  });

  it('pins an engine issue to its field and lists the rest at the top', () => {
    const container = show(task, { issues: [
      { code: 'APL', severity: 'ERROR', message: 'engine-task requires the service topic', path: '/flow/nodes/1/service' },
      { code: 'APL', severity: 'ERROR', message: 'node is unreachable', path: '/flow/nodes/1' },
    ] });
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('2 validation issues');
    expect(status.textContent).toContain('node is unreachable');
    expect(status.textContent).not.toContain('requires the service topic');
    expect(container.querySelector('[data-section="work"]')?.textContent).toContain('requires the service topic');
  });

  it('edits the agent evidence override, only ever stricter than the project', () => {
    const onUpdateNode = vi.fn();
    const container = show(agent, { onUpdateNode });
    const evidence = container.querySelector('[data-section="evidence"] button[aria-expanded]')!;
    click(evidence);
    type(byLabel<HTMLSelectElement>(container, 'Evidence payloads'), 'none');
    expect(onUpdateNode).toHaveBeenLastCalledWith(expect.objectContaining({
      agentConfig: expect.objectContaining({ evidence: { payloads: 'none' } }) }));
    expect(container.textContent).toContain('the engine applies the stricter of the two');
  });

  it('shows an overview, not invented stats, when nothing is selected', () => {
    const container = show(null);
    expect(container.textContent).toContain('Select a step to edit it');
    expect(container.textContent).toContain('This process · 2 steps');
    expect(container.textContent).not.toContain('Serverless');
  });
});
