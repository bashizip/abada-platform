import React from 'react';
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { FormRenderer } from './FormRenderer';
import { FormSchema } from './formSchema';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const schema: FormSchema = {
  title: 'Approval',
  fields: [
    { id: 'approved', type: 'boolean', label: 'Approved', required: true },
    { id: 'amount', type: 'number', label: 'Amount' },
    { id: 'notes', type: 'textarea', label: 'Notes' },
  ],
};

function renderInto(el: React.ReactElement): { root: Root; container: HTMLDivElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return { root, container };
}

describe('FormRenderer', () => {
  it('binds values by field.id, not by label', () => {
    const { container } = renderInto(
      <FormRenderer schema={schema} values={{ amount: 42, notes: 'hello' }} />,
    );

    expect(container.textContent).toContain('Amount');
    expect(container.textContent).toContain('Notes');
    // The number input's value is keyed by id "amount".
    const numberInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(numberInput.value).toBe('42');
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('hello');
  });

  it('seeds nothing extra and renders empty fields for missing variables', () => {
    const { container } = renderInto(<FormRenderer schema={schema} values={{}} />);
    const numberInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(numberInput.value).toBe('');
  });

  it('disables inputs in readOnly mode', () => {
    const { container } = renderInto(<FormRenderer schema={schema} readOnly />);
    const numberInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(numberInput.disabled).toBe(true);
    expect(checkbox.disabled).toBe(true);
  });

  it('reports per-field errors', () => {
    const { container } = renderInto(
      <FormRenderer schema={schema} errors={{ approved: 'Approved is required' }} />,
    );
    expect(container.textContent).toContain('Approved is required');
  });

  it('broadcasts changes keyed by field.id on interaction', () => {
    let latest: Record<string, unknown> | undefined;
    const { container } = renderInto(
      <FormRenderer schema={schema} values={{}} onChange={(v) => { latest = v; }} />,
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => {
      checkbox.click();
    });
    expect(latest).toEqual({ approved: true });
  });
});
