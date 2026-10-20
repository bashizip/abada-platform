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
      // A required yes/no field must be checked, as the engine enforces it.
      approved: 'Approved must be checked',
      amount: 'Amount must be a number',
    });
  });

  it('accepts a valid submission', () => {
    const errors = validateForm(schema, { approved: true, amount: 5, notes: 'ok', category: 'a' });
    expect(errors).toEqual({});
  });
});

import { autoColumns, densityFor, formProblems, submittedValues, violationMessages } from './formSchema';

describe('density', () => {
  it('is comfortable up to 6 fields, standard up to 15, compact beyond', () => {
    expect([1, 6, 7, 15, 16, 40].map(densityFor)).toEqual(
      ['comfortable', 'comfortable', 'standard', 'standard', 'compact', 'compact']);
  });

  it('puts a long flat form in 3 columns on a wide screen and 1 on a phone', () => {
    expect(autoColumns('compact', 1024)).toBe(3);
    expect(autoColumns('compact', 700)).toBe(2);
    expect(autoColumns('standard', 1024)).toBe(2);
    expect(autoColumns('comfortable', 1024)).toBe(1);
    expect(autoColumns('compact', 390)).toBe(1);
  });
});

describe('formProblems', () => {
  const field = (extra: Record<string, unknown>) => ({ id: 'a', type: 'string', label: 'A', ...extra }) as FormSchema['fields'][number];
  it.each([
    ['an unknown type', field({ type: 'colour' }), 'unknown type'],
    ['a file field', field({ type: 'file' }), 'file fields arrive'],
    ['a bad variable name', field({ id: '1a' }), 'letters, digits'],
    ['a select without options', field({ type: 'select' }), 'at least one non-empty option'],
    ['a duplicate option', field({ type: 'radio', options: ['x', 'x'] }), 'listed twice'],
    ['a look-ahead pattern', field({ pattern: '(?=x)y' }), 'not portable'],
    ['an inline flag', field({ pattern: '(?i)abc' }), 'browsers read differently'],
    ['lengths on a date', field({ type: 'date', maxLength: 2 }), 'only apply to text fields'],
    ['min over max', field({ type: 'number', min: 5, max: 2 }), 'min is larger'],
    ['a bad date bound', field({ type: 'date', min: '01/02/2026' }), 'ISO dates'],
    ['a bad currency', field({ type: 'currency', currency: 'euro' }), 'ISO currency code'],
    ['a required display', field({ type: 'display', variable: 'x', required: true }), 'cannot be required'],
    ['a member access in visible_when', field({ visible_when: 'lead.size > 1' }), 'show-when'],
  ])('refuses %s', (_name, broken, message) => {
    expect(formProblems({ fields: [broken] }).join(' ')).toContain(message);
  });

  it.each([
    ['five fields in a row', [['a', 'b', 'c', 'd', 'e']], 'holds 1 to 4'],
    ['spans over four', [[{ field: 'a', span: 3 }, { field: 'b', span: 2 }]], 'more than 4'],
    ['an unknown field', [['a', 'b', 'zz']], "'zz' is not a field"],
    ['a field placed twice', [['a', 'b'], ['a']], 'placed 2 times'],
    ['a field not placed', [['a']], "'b' is not placed"],
  ])('refuses a layout with %s', (_name, rows, message) => {
    const fields = ['a', 'b', 'c', 'd', 'e'].slice(0, 2).map((id) => ({ id, type: 'string' as const, label: id }));
    expect(formProblems({ fields, layout: { sections: [{ id: 'main', rows }] } }).join(' ')).toContain(message);
  });

  it('wants steps to cover every section once, in order', () => {
    const fields = [{ id: 'a', type: 'string' as const, label: 'A' }, { id: 'b', type: 'string' as const, label: 'B' }];
    const sections = [{ id: 'one', rows: [['a']] }, { id: 'two', rows: [['b']] }];
    expect(formProblems({ fields, layout: { sections, steps: [{ title: '1', sections: ['one'] }, { title: '2', sections: ['two'] }] } })).toEqual([]);
    expect(formProblems({ fields, layout: { sections, steps: [{ title: '1', sections: ['two', 'one'] }] } }).join(' ')).toContain('in section order');
  });
});

describe('submittedValues', () => {
  const form: FormSchema = {
    fields: [
      { id: 'vat_registered', type: 'boolean', label: 'VAT' },
      { id: 'vat_id', type: 'string', label: 'VAT number', required: true, visible_when: 'vat_registered == true' },
      { id: 'shown', type: 'display', label: 'Request', variable: 'request_id' },
      { id: 'note', type: 'textarea', label: 'Note' },
    ],
  };

  it('posts visible inputs only, never seeded process variables or hidden fields', () => {
    const values = { vat_registered: false, vat_id: 'PT1', note: 'ok', request_id: 'SUP-1', other: 1 };
    expect(submittedValues(form, values)).toEqual({ vat_registered: false, note: 'ok' });
    expect(submittedValues(form, { ...values, vat_registered: true })).toEqual({ vat_registered: true, vat_id: 'PT1', note: 'ok' });
  });

  it('a hidden field is never required', () => {
    expect(validateForm(form, { vat_registered: false })).toEqual({});
    expect(validateForm(form, { vat_registered: true })).toEqual({ vat_id: 'VAT number is required' });
  });

  it('turns the engine violations into field messages', () => {
    expect(violationMessages(form, [{ field: 'vat_id', rule: 'pattern' }, { field: 'unknown', rule: 'required' }]))
      .toEqual({ vat_id: 'VAT number is not in the expected format' });
  });
});
