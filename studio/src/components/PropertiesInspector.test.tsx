import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PropertiesInspector } from './PropertiesInspector';
import { render } from '@/test/render';
import type { WorkflowFile, WorkflowNode } from '@/types';

const base = { description: '', x: 0, y: 0 };
const agent: WorkflowNode = { ...base, id: 'draft', type: 'agent', title: 'Draft',
  agentConfig: { model: 'gemini-3.6-flash', systemPrompt: '', confidenceThreshold: 0, temperature: 0.2, tools: [] } };
const task: WorkflowNode = { ...base, id: 'sync', type: 'engine-task', title: 'Sync', engineTaskConfig: { service: 'crm' } };
const workflow = { nodes: [agent, task], edges: [] } as unknown as WorkflowFile;

const show = (node: WorkflowNode) => render(
  <PropertiesInspector selectedNode={node} onUpdateNode={vi.fn()} onUpdateWorkflow={vi.fn()}
    workflow={workflow} nodeCount={2} />,
);

describe('properties inspector', () => {
  it('gives engine tasks their own section: topic, error routes and timeout', () => {
    const container = show(task);
    expect(container.textContent).toContain('Engine Task');
    expect((container.querySelector('input[placeholder="crm.sync"]') as HTMLInputElement).value).toBe('crm');
    expect(container.querySelector('[aria-label="Timeout duration"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Route for any error"]')).not.toBeNull();
  });

  it('edits agent routes, timeout and fallback models instead of pointing to APL', () => {
    const container = show(agent);
    expect(container.textContent).not.toContain('edit in APL');
    expect(container.textContent).not.toContain('Error Route (on_error)');
    expect(container.querySelector('[aria-label="Low confidence (on_low_confidence)"]')).not.toBeNull();
    expect(container.textContent).toContain('Fallback models');
    expect(container.textContent).toContain('Add loop bound');
  });
});
