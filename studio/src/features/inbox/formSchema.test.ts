import { describe, expect, it } from 'vitest';
import { formValuesFromSchema, validateForm, FormSchema } from './formSchema';

const schema: FormSchema = {
  title: 'Approval',
  fields: [
    { id: 'approved', type: 'boolean', label: 'Approved', required: true },
    { id: 'amount', type: 'number', label: 'Amount' },
    { id: 'notes', type: 'textarea', label: 'Notes', defaultValue: 'n/a' },
    { id: 'category', type: 'select', label: 'Category', options: ['a', 'b'] },
  ],
};

describe('formValuesFromSchema', () => {
  it('seeds defaults for unset fields and keeps process variables', () => {
    const values = formValuesFromSchema(schema, { approved: true, amount: 100 });
    expect(values).toEqual({ approved: true, amount: 100, notes: 'n/a' });
  });
});

describe('validateForm', () => {
  it('flags missing required fields and invalid numbers', () => {
    const errors = validateForm(schema, { amount: 'not-a-number' });
    expect(errors).toEqual({
      approved: 'Approved is required',
      amount: 'Amount must be a number',
    });
  });

  it('accepts a valid submission', () => {
    const errors = validateForm(schema, { approved: true, amount: 5, notes: 'ok', category: 'a' });
    expect(errors).toEqual({});
  });
});
