import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { GatewayBranchesEditor } from './GatewayBranchesEditor';
import { byLabel, click, render, type } from '@/test/render';
import type { WorkflowEdge, WorkflowNode } from '@/types';

const nodes: WorkflowNode[] = ['archive', 'review', 'escalate'].map((id) =>
  ({ id, type: 'engine-task', title: id, description: '', x: 0, y: 0 }));
const branches: WorkflowEdge[] = [
  { id: 'e1', source: 'gate', target: 'archive', label: 'if risk == "low"', condition: 'risk == "low"' },
  { id: 'e2', source: 'gate', target: 'review', label: '' },
  { id: 'e3', source: 'gate', target: 'escalate', label: 'else' },
];

describe('gateway branches editor', () => {
  const setup = (edges = branches) => {
    const onConditionChange = vi.fn();
    const onElseChange = vi.fn();
    const container = render(<GatewayBranchesEditor branches={edges} nodes={nodes} inclusive={false}
      onConditionChange={onConditionChange} onElseChange={onElseChange} />);
    return { container, onConditionChange, onElseChange };
  };

  it('shows each branch condition and the else mark', () => {
    const { container } = setup();
    expect(byLabel<HTMLInputElement>(container, 'Condition to archive').value).toBe('risk == "low"');
    expect(byLabel<HTMLInputElement>(container, 'Else branch to escalate').checked).toBe(true);
    expect(byLabel(container, 'Condition to escalate')).toBeNull();
    expect(container.textContent).toContain('Needs a condition, or mark it as the else branch.');
  });

  it('reports condition edits and else toggles', () => {
    const { container, onConditionChange, onElseChange } = setup();
    type(byLabel<HTMLInputElement>(container, 'Condition to review'), 'score > 75');
    expect(onConditionChange).toHaveBeenCalledWith('e2', 'score > 75');
    click(byLabel(container, 'Else branch to escalate'));
    expect(onElseChange).toHaveBeenCalledWith('e3', false);
  });

  it('keeps the last branch without a condition open for one', () => {
    const { container } = setup([branches[0], { id: 'e2', source: 'gate', target: 'review', label: '' }]);
    expect(byLabel(container, 'Condition to review')).not.toBeNull();
    expect(byLabel<HTMLInputElement>(container, 'Else branch to review').checked).toBe(false);
    expect(container.textContent).toContain('No condition: this is the else branch.');
  });
});
