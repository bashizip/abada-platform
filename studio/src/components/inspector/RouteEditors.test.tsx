import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AgentRoutesEditor, LoopEditor, OutcomesEditor } from './RouteEditors';
import { blur, buttons, byLabel, click, render, type } from '@/test/render';
import type { WorkflowNode } from '@/types';

const nodes: WorkflowNode[] = ['review', 'draft', 'done'].map((id) =>
  ({ id, type: 'engine-task', title: id, description: '', x: 0, y: 0 }));

describe('outcomes editor', () => {
  it('starts approve / reject from the current next step, with a required reject comment', () => {
    const onChange = vi.fn();
    const container = render(<OutcomesEditor nextTarget="done" nodes={nodes} excludeId="review" onChange={onChange} />);
    click(buttons(container)[0]);
    expect(onChange).toHaveBeenCalledWith({ approve: { next: 'done' }, reject: { next: '', comment: 'required' } });
  });

  it('applies the engine rules to names and counts', () => {
    const onChange = vi.fn();
    const container = render(<OutcomesEditor outcomes={{ approve: { next: 'done' } }} nodes={nodes} excludeId="review" onChange={onChange} />);
    expect(container.textContent).toContain('between 2 and 6 outcomes');

    type(byLabel<HTMLInputElement>(container, 'New outcome name'), 'Bad-Name');
    expect(buttons(container).find((button) => button.textContent === 'Add')!.disabled).toBe(true);
    type(byLabel<HTMLInputElement>(container, 'New outcome name'), 'request_changes');
    click(buttons(container).find((button) => button.textContent === 'Add')!);
    expect(onChange).toHaveBeenLastCalledWith({ approve: { next: 'done' }, request_changes: { next: '' } });
  });

  it('toggles whether an outcome needs a comment', () => {
    const onChange = vi.fn();
    const container = render(<OutcomesEditor outcomes={{ approve: { next: 'done' }, reject: { next: 'draft' } }}
      nodes={nodes} excludeId="review" onChange={onChange} />);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    click(checkboxes[1]);
    expect(onChange).toHaveBeenCalledWith({ approve: { next: 'done' }, reject: { next: 'draft', comment: 'required' } });
  });
});

describe('agent routes editor', () => {
  it('starts two routes from the current next step', () => {
    const onChange = vi.fn();
    const container = render(<AgentRoutesEditor nextTarget="done" nodes={nodes} excludeId="draft" onChange={onChange} />);
    expect(container.textContent).toContain('Let the agent choose the next step');
    click(buttons(container)[0]);
    const routes = onChange.mock.calls[0][0];
    expect(Object.keys(routes)).toEqual(['continue', 'escalate']);
    expect(routes.continue.next).toBe('done');
  });

  it('asks for a description and applies the name rules', () => {
    const onChange = vi.fn();
    const container = render(<AgentRoutesEditor routes={{ ship: { next: 'done', description: 'Ready' },
      redo: { next: 'review', description: '' } }} nodes={nodes} excludeId="draft" onChange={onChange} />);
    expect(container.textContent).toContain('Describe "redo"');
    type(byLabel<HTMLInputElement>(container, 'New route name'), 'Bad-Name');
    expect(buttons(container).find((button) => button.textContent === 'Add')!.disabled).toBe(true);
    type(byLabel<HTMLInputElement>(container, 'Route redo when'), 'amount <= 500.0');
    expect(onChange).toHaveBeenLastCalledWith({ ship: { next: 'done', description: 'Ready' },
      redo: { next: 'review', description: '', when: 'amount <= 500.0' } });
  });
});

describe('loop editor', () => {
  it('offers a bound where a cycle has none, and keeps the limit within 1–1000', () => {
    const onChange = vi.fn();
    const unbounded = render(<LoopEditor problem="unbounded" nodes={nodes} excludeId="draft" onChange={onChange} />);
    expect(unbounded.textContent).toContain('without a repeat limit');
    click(buttons(unbounded)[0]);
    expect(onChange).toHaveBeenCalledWith({ maxIterations: 3 });

    const bounded = render(<LoopEditor loop={{ maxIterations: 3 }} nodes={nodes} excludeId="draft" onChange={onChange} />);
    const input = byLabel<HTMLInputElement>(bounded, 'Maximum iterations');
    type(input, '1001');
    expect(bounded.textContent).toContain('between 1 and 1000');
    type(input, '5');
    blur(input);
    expect(onChange).toHaveBeenLastCalledWith({ maxIterations: 5 });
    type(byLabel<HTMLSelectElement>(bounded, 'When the limit is reached'), 'done');
    expect(onChange).toHaveBeenLastCalledWith({ maxIterations: 3, onExhausted: 'done' });
  });
});
