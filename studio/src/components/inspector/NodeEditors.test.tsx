import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HumanEditor } from './HumanEditor';
import { CallProcessNodeEditor } from './WorkEditors';
import { GatewayEditor } from './FlowEditors';
import { byLabel, click, render, type } from '@/test/render';
import { ToastProvider } from '@/components/ToastContext';
import { createNode } from '@/features/designer/nodes/nodeCatalog';
import type { WorkflowNode } from '@/types';
import type { NodeEditorProps } from './nodeEditor';

const mount = (Editor: React.FC<NodeEditorProps>, node: WorkflowNode) => {
  const update = vi.fn();
  const container = render(
    <ToastProvider>
      <Editor node={node} nodes={[node]} issues={[]} update={update} routeTo={vi.fn()} commitWithRoutes={vi.fn()} />
    </ToastProvider>,
  );
  return { container, update, last: (): WorkflowNode => update.mock.calls.at(-1)![0] };
};

describe('human task editor', () => {
  const gate: WorkflowNode = { ...createNode('human-input', 'gate', { x: 0, y: 0 }),
    humanConfig: { kind: 'approval-gate', assignees: ['risk', 'legal'], formFields: [] } };

  it('flags the deprecated approval gate, hides the form and converts on request', () => {
    const { container, last } = mount(HumanEditor, gate);
    expect(container.textContent).toContain('deprecated alias');
    expect(container.textContent).not.toContain('Form');
    click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Convert to a human task')!);
    expect(last().humanConfig!.kind).toBeUndefined();
  });

  it('offers the assignment mode once there are several assignees, as a hint', () => {
    const { container, last } = mount(HumanEditor, gate);
    expect(container.textContent).toContain('the engine does not enforce');
    type(byLabel(container, 'Assignment mode'), 'parallel');
    expect(last().humanConfig!.mode).toBe('parallel');
    const single = mount(HumanEditor, { ...gate, humanConfig: { ...gate.humanConfig!, assignees: ['risk'] } });
    expect(byLabel(single.container, 'Assignment mode')).toBeNull();
  });

  it('says a reserved key is kept but has no effect', () => {
    const { container } = mount(HumanEditor, { ...gate, humanConfig: { assignees: ['ops'], formFields: [] },
      aplExtras: { requireDoubleSignOff: true } });
    expect(container.textContent).toContain('reserved and has no effect');
  });
});

describe('for-each editor', () => {
  it('edits the list, item variable, bounds and results', () => {
    const node = createNode('for-each', 'check_each', { x: 0, y: 0 });
    const { container, last } = mount(CallProcessNodeEditor, node);
    type(byLabel(container, 'Items'), '${documents}');
    expect(last().callProcessConfig!.forEach!.items).toBe('${documents}');
    type(byLabel(container, 'Max parallel'), '3');
    expect(last().callProcessConfig!.forEach!.maxParallel).toBe(3);
    type(byLabel(container, 'Results variable'), 'check_results');
    expect(last().callProcessConfig!.forEach!.results).toBe('check_results');
    expect(container.textContent).toContain('Child process per item');
  });

  it('says what the engine would refuse', () => {
    const node = createNode('for-each', 'check_each', { x: 0, y: 0 });
    const { container } = mount(CallProcessNodeEditor, node);
    expect(container.textContent).toContain('Give the expression that evaluates to the list.');
  });
});

describe('gateway editor', () => {
  it('switches the gateway kind with glyph choices', () => {
    const { container, last } = mount(GatewayEditor, createNode('exclusive', 'decide', { x: 0, y: 0 }));
    const radios = [...container.querySelectorAll('[role="radio"]')];
    expect(radios.map((radio) => radio.querySelector('[data-shape]')?.getAttribute('data-shape'))).toEqual(['gateway', 'gateway', 'gateway']);
    click(radios[1]);
    expect(last().subtype).toBe('parallel');
  });
});
