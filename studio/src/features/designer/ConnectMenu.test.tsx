import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectMenu } from './ConnectMenu';
import { buttons, byLabel, click, render, type } from '@/test/render';
import type { WorkflowNode } from '@/types';

const node = (patch: Partial<WorkflowNode>): WorkflowNode =>
  ({ id: 'n', type: 'engine-task', title: 'N', description: '', x: 0, y: 0, ...patch });

const agent = node({ id: 'draft', type: 'agent', title: 'Draft', loop: { maxIterations: 3 },
  agentConfig: { model: 'm', systemPrompt: '', confidenceThreshold: 0, temperature: 0.2, tools: [] } });
const review = node({ id: 'review', type: 'human', title: 'Review',
  humanConfig: { assignees: ['r'], formFields: [], outcomes: { approve: { next: 'done' }, reject: { next: 'draft' } } } });
const target = node({ id: 'manual', title: 'Manual' });

const labels = (container: Element) => buttons(container).map((button) => button.textContent);

describe('connect menu', () => {
  it('offers only the routes the source supports', () => {
    expect(labels(render(<ConnectMenu source={agent} target={target} x={0} y={0} onChoose={vi.fn()} onCancel={vi.fn()} />)))
      .toEqual(['Next step', 'On error', 'On timeout…', 'Low confidence', 'Invalid output', 'Loop limit reached']);
    expect(labels(render(<ConnectMenu source={review} target={target} x={0} y={0} onChoose={vi.fn()} onCancel={vi.fn()} />)))
      .toEqual(['Outcome: approve', 'Outcome: reject', 'On error', 'On timeout…']);
  });

  it('asks a timeout for an engine-valid duration', () => {
    const onChoose = vi.fn();
    const container = render(<ConnectMenu source={agent} target={target} x={0} y={0} onChoose={onChoose} onCancel={vi.fn()} />);
    click(buttons(container).find((button) => button.textContent === 'On timeout…')!);

    const input = container.querySelector('#connect-timeout') as HTMLInputElement;
    type(input, 'two hours');
    expect(container.textContent).toContain('ISO-8601');
    const submit = buttons(container).find((button) => button.textContent === 'Add timeout')!;
    expect(submit.disabled).toBe(true);

    type(input, 'pt2h');
    click(submit);
    expect(onChoose).toHaveBeenCalledWith({ kind: 'timeout', after: 'PT2H' });
  });

  it('lets an error route name the code it catches', () => {
    const onChoose = vi.fn();
    const container = render(<ConnectMenu source={agent} target={target} x={0} y={0} onChoose={onChoose} onCancel={vi.fn()} />);
    click(buttons(container).find((button) => button.textContent === 'On error')!);
    type(byLabel<HTMLInputElement>(container, 'Connect Draft to Manual').querySelector('#connect-error-code')!, 'QUOTA');
    click(buttons(container).find((button) => button.textContent === 'Add error route')!);
    expect(onChoose).toHaveBeenCalledWith({ kind: 'error', code: 'QUOTA' });
  });
});
