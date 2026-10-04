import React, { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NewWorkflowModal } from './NewWorkflowModal';
import { buttons, click, render, type } from '@/test/render';
import type { WorkflowFile } from '@/types';

const APL = `version: abada.io/v1
metadata:
  key: complaint_reply
  name: Complaint reply
flow:
  entry: start
  nodes:
    - id: start
      type: webhook
      next: done
    - id: done
      type: end
`;

function typeArea(area: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const press = (container: Element, label: string) =>
  click(buttons(container).find((button) => button.textContent?.includes(label))!);

function create(mode: string, fileName: string, source?: string): WorkflowFile {
  const onCreate = vi.fn();
  const container = render(<NewWorkflowModal isOpen onClose={vi.fn()} onCreateWorkflow={onCreate} />);
  press(container, mode);
  if (source) typeArea(container.querySelector('textarea')!, source);
  type(container.querySelector('input[placeholder="e.g. international_trade_clearance"]') as HTMLInputElement, fileName);
  press(container, 'Create Process');
  expect(onCreate).toHaveBeenCalledOnce();
  return onCreate.mock.calls[0][0];
}

describe('new process', () => {
  it('keeps the pasted process name and stores the file name apart', () => {
    const workflow = create('Paste APL', 'complaint_reply', APL);
    expect(workflow.name).toBe('Complaint reply');
    expect(workflow.fileName).toBe('complaint_reply.apl.yaml');
    expect(workflow.processKey).toBe('complaint_reply');
  });

  it('names an empty process after its file, without the extension', () => {
    const workflow = create('Empty APL', 'claims_intake');
    expect(workflow.name).toBe('claims_intake');
    expect(workflow.fileName).toBe('claims_intake.apl.yaml');
  });
});
