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

import supplierSource from '../../../../engine/src/test/resources/apl/forms/supplier-onboarding.json?raw';

const supplier = JSON.parse(supplierSource) as FormSchema;
const four: FormSchema = {
  title: 'Expense approval',
  fields: [
    { id: 'approved_amount', type: 'currency', label: 'Approved amount', currency: 'EUR', required: true },
    { id: 'cost_center', type: 'select', label: 'Cost centre', options: ['CC-110', 'CC-240'] },
    { id: 'pay_on', type: 'date', label: 'Pay on' },
    { id: 'reason', type: 'textarea', label: 'Note' },
  ],
};
const root = (container: HTMLElement) => container.querySelector('[data-density]') as HTMLElement;

describe('FormRenderer layout and density', () => {
  it('a 4-field form is comfortable, one column, at desktop and mobile widths', () => {
    for (const width of [1024, 390]) {
      const { container } = renderInto(<FormRenderer schema={four} width={width} />);
      expect(root(container).dataset.density).toBe('comfortable');
      expect(root(container).dataset.columns).toBe('1');
    }
  });

  it('the 25-field form is compact on a 4-column grid at desktop width and one column on a phone', () => {
    const desktop = renderInto(<FormRenderer schema={supplier} width={1024} variables={{ request_id: 'SUP-1' }} />).container;
    expect(root(desktop).dataset.density).toBe('compact');
    expect(root(desktop).dataset.columns).toBe('4');
    expect(root(desktop).dataset.layout).toBe('desktop');
    const legal = desktop.querySelector('[data-field="legal_name"]') as HTMLElement;
    expect(legal.style.gridColumn).toBe('span 2');
    expect(desktop.textContent).toContain('SUP-1');

    const phone = renderInto(<FormRenderer schema={supplier} width={390} />).container;
    expect(root(phone).dataset.columns).toBe('1');
    expect(root(phone).dataset.layout).toBe('mobile');
    expect((phone.querySelector('[data-field="legal_name"]') as HTMLElement).style.gridColumn).toBe('1 / -1');
  });

  it('a long form without layout flows into 3 columns, 2 on a tablet, 1 on a phone', () => {
    const fields = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, type: 'string' as const, label: `Field ${i}` }));
    const columns = (width: number) => root(renderInto(<FormRenderer schema={{ fields }} width={width} />).container).dataset.columns;
    expect([columns(1024), columns(700), columns(390)]).toEqual(['3', '2', '1']);
  });

  it('shows a field only when its visible_when holds', () => {
    const hidden = renderInto(<FormRenderer schema={supplier} width={1024} values={{ vat_registered: false }} />).container;
    expect(hidden.querySelector('[data-field="vat_id"]')).toBeNull();
    const shown = renderInto(<FormRenderer schema={supplier} width={1024} values={{ vat_registered: true }} />).container;
    expect(shown.querySelector('[data-field="vat_id"]')).not.toBeNull();
  });

  it('walks the wizard: Next checks the current step only', () => {
    let errors: Record<string, string> = {};
    const stepped = { ...supplier, layout: { ...supplier.layout!, steps: supplier.layout!.steps } };
    const { container } = renderInto(<FormRenderer schema={stepped} width={1024} onErrors={(next) => { errors = next; }} />);
    expect(container.textContent).toContain('Step 1 of 3');
    const next = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.startsWith('Next')) as HTMLButtonElement;
    act(() => { next.click(); });
    expect(Object.keys(errors)).toContain('legal_name');
    expect(Object.keys(errors)).not.toContain('iban');
    expect(container.textContent).toContain('Step 1 of 3');
  });

  it('renders help text as text, never as HTML', () => {
    const { container } = renderInto(<FormRenderer schema={{ fields: [
      { id: 'help', type: 'markdown', label: 'Help', text: '**Check** the <img src=x onerror=alert(1)> [policy](https://example.com)' },
    ] }} width={1024} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('Check');
    expect(container.querySelector('a')?.getAttribute('rel')).toContain('noopener');
  });

  it('keeps a currency draft while typing and reports a number', () => {
    let latest: Record<string, unknown> = {};
    const { container } = renderInto(<FormRenderer schema={four} width={1024} onChange={(v) => { latest = v; }} />);
    const input = container.querySelector('#field-approved_amount') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '1284.5');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(latest).toEqual({ approved_amount: 1284.5 });
  });
});
