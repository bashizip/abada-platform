import { describe, expect, it } from 'vitest';
import { FormSchema, formProblems } from '@/features/inbox/formSchema';
import {
  addField, addSection, locate, maxSpan, moveField, nudgeField, removeField, removeSection, setSpan, setStepStarts,
  shiftInRow, updateField, withLayout,
} from './formModel';

const flat: FormSchema = {
  title: 'Approval',
  fields: [
    { id: 'name', type: 'string', label: 'Name' },
    { id: 'amount', type: 'number', label: 'Amount' },
    { id: 'due', type: 'date', label: 'Due' },
    { id: 'notes', type: 'textarea', label: 'Notes' },
  ],
};

const cells = (schema: FormSchema) => schema.layout!.sections.map((section) =>
  section.rows.map((row) => row.map((cell) => (typeof cell === 'string' ? cell : `${cell.field}:${cell.span}`))));

describe('withLayout', () => {
  it('lays a flat form out by default widths without changing its fields', () => {
    const laid = withLayout(flat);
    expect(laid.fields).toEqual(flat.fields);
    expect(cells(laid)).toEqual([[['name:2', 'amount:1', 'due:1'], ['notes:4']]]);
    expect(formProblems(laid)).toEqual([]);
  });
});

describe('editing', () => {
  const laid = withLayout(flat);

  it('adds a field with a fresh variable name into a row with room, else a new row', () => {
    const one = addField(laid, 'date', 0, 1);
    expect(one.id).toBe('date');
    expect(cells(one.schema)[0][2]).toEqual(['date:1']);
    const two = addField(one.schema, 'date', 0, 0);
    expect(two.id).toBe('date_2');
    expect(formProblems(two.schema)).toEqual([]);
  });

  it('refuses to move a field into a full row', () => {
    expect(moveField(laid, 'notes', 0, 0)).toBe(laid);
    const narrow = setSpan(laid, 'name', 1);
    const moved = moveField(narrow, 'notes', 0, 0);
    expect(cells(moved)).toEqual([[['name:1', 'amount:1', 'due:1', 'notes:1']]]);
  });

  it('clamps a span to the room left in its row', () => {
    expect(maxSpan(laid, 'name')).toBe(2);
    expect(cells(setSpan(laid, 'name', 4))[0][0][0]).toBe('name:2');
    expect(cells(setSpan(laid, 'amount', 0))[0][0][1]).toBe('amount:1');
  });

  it('nudges a field up into a row with room, or into a row of its own', () => {
    const up = nudgeField(setSpan(laid, 'name', 1), 'notes', 'up');
    expect(cells(up)).toEqual([[['name:1', 'amount:1', 'due:1', 'notes:1']]]);
    const down = nudgeField(laid, 'amount', 'down');
    expect(cells(down)).toEqual([[['name:2', 'due:1'], ['amount:1'], ['notes:4']]]);
    expect(cells(shiftInRow(laid, 'amount', 1))[0][0]).toEqual(['name:2', 'due:1', 'amount:1']);
  });

  it('renames a variable in its layout cell and removes a field with its cell', () => {
    const renamed = updateField(laid, 'name', { id: 'legal_name' });
    expect(locate(renamed, 'legal_name')).toEqual({ section: 0, row: 0, cell: 0 });
    expect(formProblems(renamed)).toEqual([]);
    const removed = removeField(laid, 'notes');
    expect(removed.fields.map((field) => field.id)).toEqual(['name', 'amount', 'due']);
    expect(cells(removed)).toEqual([[['name:2', 'amount:1', 'due:1']]]);
  });

  it('splits sections into wizard steps and keeps them covered', () => {
    const two = addSection(laid);
    const moved = moveField(two.schema, 'notes', 1, -1);
    const stepped = setStepStarts(moved, [two.id], { [two.id]: 'Details' });
    expect(stepped.layout!.steps).toEqual([{ title: '', sections: ['main'] }, { title: 'Details', sections: [two.id] }]);
    expect(formProblems(stepped)).toEqual([]);
    const third = addSection(stepped);
    expect(third.schema.layout!.steps![1].sections).toEqual([two.id, third.id]);
    expect(removeSection(third.schema, third.id).layout!.steps![1].sections).toEqual([two.id]);
    expect(setStepStarts(stepped, []).layout!.steps).toBeUndefined();
  });
});
