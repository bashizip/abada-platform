/**
 * Edits of a task form in the designer, as pure functions over the schema.
 * Every edit returns a new schema, so undo/redo is a stack of snapshots, and
 * keeps the layout rules the engine checks at deploy (a row holds 1-4 fields
 * whose widths add up to at most 4; every field is placed exactly once).
 */
import {
  FormCell, FormField, FormFieldType, FormSchema, FormSection, GRID_COLUMNS, MAX_ROW_CELLS, cellField, cellSpan,
  defaultSpan,
} from '@/features/inbox/formSchema';

export interface CellAt {
  section: number;
  row: number;
  cell: number;
}

const normalizeRow = (row: (string | FormCell)[]): FormCell[] =>
  row.map((cell) => ({ field: cellField(cell), span: cellSpan(cell) }));

const rowWidth = (row: FormCell[], except?: string): number =>
  row.reduce((sum, cell) => sum + (cell.field === except ? 0 : cellSpan(cell)), 0);

/** A form with a layout: a flat form becomes one section, fields two to a row by their default width. */
export function withLayout(schema: FormSchema): FormSchema {
  if (schema.layout?.sections?.length) {
    return {
      ...schema,
      layout: {
        ...schema.layout,
        sections: schema.layout.sections.map((section) => ({ ...section, rows: section.rows.map(normalizeRow) })),
      },
    };
  }
  const rows: FormCell[][] = [];
  for (const field of schema.fields ?? []) {
    const span = defaultSpan(field.type);
    const last = rows[rows.length - 1];
    if (last && last.length < MAX_ROW_CELLS && rowWidth(last) + span <= GRID_COLUMNS) last.push({ field: field.id, span });
    else rows.push([{ field: field.id, span }]);
  }
  return { ...schema, fields: [...(schema.fields ?? [])], layout: { sections: [{ id: 'main', title: '', rows }] } };
}

export function locate(schema: FormSchema, fieldId: string): CellAt | null {
  const sections = schema.layout?.sections ?? [];
  for (let s = 0; s < sections.length; s++) {
    for (let r = 0; r < sections[s].rows.length; r++) {
      const c = sections[s].rows[r].findIndex((cell) => cellField(cell) === fieldId);
      if (c >= 0) return { section: s, row: r, cell: c };
    }
  }
  return null;
}

function mapSections(schema: FormSchema, edit: (sections: FormSection[]) => FormSection[]): FormSchema {
  const sections = (schema.layout?.sections ?? []).map((section) => ({
    ...section, rows: section.rows.map((row) => normalizeRow(row)),
  }));
  const next = edit(sections).map((section) => ({ ...section, rows: section.rows.filter((row) => row.length > 0) }));
  return { ...schema, layout: { ...schema.layout, sections: next } };
}

/** Puts a cell into a row (or a new row at the section end when `row` is -1); false when it does not fit. */
function place(sections: FormSection[], cell: FormCell, section: number, row: number): boolean {
  const target = sections[section];
  if (!target) return false;
  if (row < 0 || row >= target.rows.length) {
    target.rows.push([cell]);
    return true;
  }
  const cells = target.rows[row] as FormCell[];
  const free = GRID_COLUMNS - rowWidth(cells);
  if (cells.length >= MAX_ROW_CELLS || free < 1) return false;
  cells.push({ ...cell, span: Math.min(cellSpan(cell), free) });
  return true;
}

const LABELS: Record<FormFieldType, string> = {
  string: 'Text', textarea: 'Long text', number: 'Number', currency: 'Amount', email: 'Email', url: 'Website',
  select: 'Choice', radio: 'Option', multiselect: 'Tags', 'checkbox-group': 'Checklist', boolean: 'Confirmed',
  date: 'Date', datetime: 'Date and time', display: 'Shown value', markdown: 'Help text', file: 'File',
};

/** A new field of this type, with a variable name not used yet. */
export function newField(schema: FormSchema, type: FormFieldType): FormField {
  const base = type.replace('-', '_');
  let id = base;
  for (let n = 2; schema.fields.some((field) => field.id === id); n++) id = `${base}_${n}`;
  const field: FormField = { id, type, label: LABELS[type] };
  if (['select', 'radio', 'multiselect', 'checkbox-group'].includes(type)) field.options = ['Option 1', 'Option 2'];
  if (type === 'currency') field.currency = 'EUR';
  if (type === 'display') field.variable = 'variable_name';
  if (type === 'markdown') field.text = 'Explain what the person should check here.';
  return field;
}

/** Adds a field of `type` into a section (and row; -1 = new row). Returns the schema and the new field id. */
export function addField(schema: FormSchema, type: FormFieldType, section = -1, row = -1): { schema: FormSchema; id: string } {
  const laid = withLayout(schema);
  const field = newField(laid, type);
  const targetSection = section < 0 ? laid.layout!.sections.length - 1 : section;
  const next = mapSections({ ...laid, fields: [...laid.fields, field] }, (sections) => {
    const cell = { field: field.id, span: defaultSpan(type) };
    if (!place(sections, cell, targetSection, row)) place(sections, cell, targetSection, -1);
    return sections;
  });
  return { schema: next, id: field.id };
}

/** Moves a field into a row (or a new row with -1); unchanged when that row is full. */
export function moveField(schema: FormSchema, fieldId: string, section: number, row: number): FormSchema {
  const from = locate(schema, fieldId);
  if (!from) return schema;
  if (from.section === section && from.row === row) return schema;
  let moved = false;
  const next = mapSections(schema, (sections) => {
    const cell = (sections[from.section].rows[from.row] as FormCell[])[from.cell];
    const rows = sections[section]?.rows;
    const target = rows && row >= 0 && row < rows.length ? (rows[row] as FormCell[]) : null;
    if (target && (target.length >= MAX_ROW_CELLS || GRID_COLUMNS - rowWidth(target) < 1)) return sections;
    sections[from.section].rows[from.row] = (sections[from.section].rows[from.row] as FormCell[]).filter((_, i) => i !== from.cell);
    moved = place(sections, cell, section, row);
    return sections;
  });
  return moved ? next : schema;
}

/** Keyboard move: up/down into the neighbouring row when it has room, else into a row of its own. */
export function nudgeField(schema: FormSchema, fieldId: string, direction: 'up' | 'down'): FormSchema {
  const from = locate(schema, fieldId);
  if (!from) return schema;
  return mapSections(schema, (sections) => {
    const rows = sections[from.section].rows as FormCell[][];
    const alone = rows[from.row].length === 1;
    const cell = rows[from.row][from.cell];
    const targetIndex = direction === 'up' ? from.row - 1 : from.row + 1;
    const target = rows[targetIndex];
    if (target && target.length < MAX_ROW_CELLS && rowWidth(target) < GRID_COLUMNS) {
      rows[from.row] = rows[from.row].filter((_, i) => i !== from.cell);
      target.push({ ...cell, span: Math.min(cellSpan(cell), GRID_COLUMNS - rowWidth(target)) });
      return sections;
    }
    if (alone) {
      // Swap with the neighbouring full row, or cross into the neighbouring section.
      if (target) {
        [rows[from.row], rows[targetIndex]] = [rows[targetIndex], rows[from.row]];
      } else {
        const neighbour = sections[from.section + (direction === 'up' ? -1 : 1)];
        if (neighbour) {
          rows.splice(from.row, 1);
          if (direction === 'up') neighbour.rows.push([cell]);
          else neighbour.rows.unshift([cell]);
        }
      }
      return sections;
    }
    rows[from.row] = rows[from.row].filter((_, i) => i !== from.cell);
    rows.splice(direction === 'up' ? from.row : from.row + 1, 0, [cell]);
    return sections;
  });
}

/** Reorders a field within its row (left/right with Alt, and the inline editor). */
export function shiftInRow(schema: FormSchema, fieldId: string, delta: -1 | 1): FormSchema {
  const from = locate(schema, fieldId);
  if (!from) return schema;
  return mapSections(schema, (sections) => {
    const row = sections[from.section].rows[from.row] as FormCell[];
    const to = from.cell + delta;
    if (to < 0 || to >= row.length) return sections;
    [row[from.cell], row[to]] = [row[to], row[from.cell]];
    return sections;
  });
}

/** The widest span this field can take in its row. */
export function maxSpan(schema: FormSchema, fieldId: string): number {
  const at = locate(schema, fieldId);
  if (!at) return GRID_COLUMNS;
  const row = normalizeRow(schema.layout!.sections[at.section].rows[at.row]);
  return GRID_COLUMNS - rowWidth(row, fieldId);
}

export function setSpan(schema: FormSchema, fieldId: string, span: number): FormSchema {
  const at = locate(schema, fieldId);
  if (!at) return schema;
  const allowed = Math.max(1, Math.min(span, maxSpan(schema, fieldId)));
  return mapSections(schema, (sections) => {
    const row = sections[at.section].rows[at.row] as FormCell[];
    row[at.cell] = { ...row[at.cell], span: allowed };
    return sections;
  });
}

export function removeField(schema: FormSchema, fieldId: string): FormSchema {
  const at = locate(schema, fieldId);
  const without = { ...schema, fields: schema.fields.filter((field) => field.id !== fieldId) };
  if (!at) return without;
  return mapSections(without, (sections) => {
    sections[at.section].rows[at.row] = (sections[at.section].rows[at.row] as FormCell[]).filter((_, i) => i !== at.cell);
    return sections;
  });
}

/** Updates a field; a new id is applied to its layout cell too. */
export function updateField(schema: FormSchema, fieldId: string, patch: Partial<FormField>): FormSchema {
  const fields = schema.fields.map((field) => {
    if (field.id !== fieldId) return field;
    const next: FormField = { ...field, ...patch };
    (Object.keys(next) as (keyof FormField)[]).forEach((key) => {
      if (next[key] === undefined || next[key] === '') delete next[key];
    });
    if (!next.label) next.label = '';
    return next;
  });
  const renamed = patch.id && patch.id !== fieldId ? patch.id : null;
  const updated = { ...schema, fields };
  if (!renamed || !schema.layout) return updated;
  return mapSections(updated, (sections) => sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => (row as FormCell[]).map((cell) => (cell.field === fieldId ? { ...cell, field: renamed } : cell))),
  })));
}

export function addSection(schema: FormSchema): { schema: FormSchema; id: string } {
  const laid = withLayout(schema);
  const sections = laid.layout!.sections;
  let id = `section_${sections.length + 1}`;
  for (let n = sections.length + 2; sections.some((section) => section.id === id); n++) id = `section_${n}`;
  const steps = laid.layout!.steps;
  return {
    schema: {
      ...laid,
      layout: {
        ...laid.layout!,
        sections: [...sections, { id, title: 'New section', rows: [] }],
        // A new section joins the last step, so steps keep covering every section.
        steps: steps?.length ? steps.map((step, i) => (i === steps.length - 1 ? { ...step, sections: [...step.sections, id] } : step)) : steps,
      },
    },
    id,
  };
}

export function updateSection(schema: FormSchema, sectionId: string, patch: Partial<FormSection>): FormSchema {
  return mapSections(schema, (sections) => sections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)));
}

/** Removes an empty section. */
export function removeSection(schema: FormSchema, sectionId: string): FormSchema {
  const section = schema.layout?.sections.find((candidate) => candidate.id === sectionId);
  if (!section || section.rows.some((row) => row.length > 0) || (schema.layout?.sections.length ?? 0) <= 1) return schema;
  const steps = schema.layout?.steps?.map((step) => ({ ...step, sections: step.sections.filter((id) => id !== sectionId) }))
    .filter((step) => step.sections.length > 0);
  return {
    ...schema,
    layout: { sections: schema.layout!.sections.filter((candidate) => candidate.id !== sectionId), steps: steps?.length ? steps : undefined },
  };
}

/**
 * Wizard steps: `starts` lists the section ids that begin a step; every
 * section belongs to the step started before it. An empty list removes steps.
 */
export function setStepStarts(schema: FormSchema, starts: string[], titles: Record<string, string> = {}): FormSchema {
  const sections = schema.layout?.sections ?? [];
  if (starts.length === 0 || sections.length < 2) return { ...schema, layout: { sections, steps: undefined } };
  const steps: { title: string; sections: string[] }[] = [];
  sections.forEach((section, index) => {
    if (index === 0 || starts.includes(section.id)) {
      steps.push({ title: titles[section.id] ?? section.title ?? `Step ${steps.length + 1}`, sections: [section.id] });
    } else {
      steps[steps.length - 1].sections.push(section.id);
    }
  });
  return { ...schema, layout: { sections, steps: steps.length > 1 ? steps : undefined } };
}

export const stepStarts = (schema: FormSchema): string[] =>
  (schema.layout?.steps ?? []).map((step) => step.sections[0]).filter(Boolean);
