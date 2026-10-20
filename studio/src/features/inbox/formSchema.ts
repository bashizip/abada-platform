/**
 * Canonical task-form schema shared by the Studio form designer, the Task Inbox
 * renderer and any other form consumer. A form is a plain JSON project
 * resource (kind FORM); the schema below is the contract for that JSON.
 *
 * The engine enforces the same contract: it pins the form when the process is
 * deployed and checks every completion against it
 * (`engine/.../forms/FormSchema.java`, `FormSubmission.java`). The rules here
 * are a convenience for the person filling the form; both sides run
 * `engine/src/test/resources/forms/submission-conformance.json`.
 *
 * `field.id` IS the process-variable name: every renderer binds values by
 * `id`, never by label. `fields` is the flat, canonical list; the optional
 * `layout` only places field ids into sections, rows and steps.
 */
import { isVisible, visibilityProblem } from './visibility';

export type FormFieldType =
  | 'string' | 'textarea' | 'number' | 'boolean' | 'select' | 'date'
  | 'email' | 'url' | 'currency' | 'multiselect' | 'radio' | 'checkbox-group' | 'datetime'
  | 'display' | 'markdown' | 'file';

export interface FormOption {
  value: string;
  label?: string;
}

export interface FormField {
  /** Process-variable name this field binds to (unique within the form). */
  id: string;
  type: FormFieldType;
  label: string;
  required?: boolean;
  /** For select, radio, multiselect and checkbox-group. */
  options?: (string | FormOption)[];
  /** Pre-filled value used when the variable is not yet set. */
  defaultValue?: unknown;
  placeholder?: string;
  help?: string;
  /** Numbers/currency: bounds; multiselect/checkbox-group: selection counts; date/datetime: ISO strings. */
  min?: number | string;
  max?: number | string;
  minLength?: number;
  maxLength?: number;
  /** A portable regular expression the whole value must match (string, textarea). */
  pattern?: string;
  /** ISO 4217 code of a currency field. */
  currency?: string;
  /** Portable CEL subset over form values and process variables; see `visibility.ts`. */
  visible_when?: string;
  /** For `display`: the process variable shown. */
  variable?: string;
  /** For `markdown`: the help text. */
  text?: string;
  /** For `file`: extensions (`.pdf`) and content types (`image/*`) accepted; empty accepts any. */
  accept?: string[];
  /** For `file`: several files (the value is a list); `min`/`max` then count them. */
  multiple?: boolean;
  /** For `file`: the largest file in bytes; the engine's own cap still applies. */
  maxSize?: number;
}

export interface FormCell {
  field: string;
  span?: number;
}

export interface FormSection {
  id: string;
  title?: string;
  description?: string;
  collapsible?: boolean;
  rows: (string | FormCell)[][];
}

export interface FormStep {
  title: string;
  sections: string[];
}

export interface FormLayout {
  sections: FormSection[];
  steps?: FormStep[];
}

export interface FormSchema {
  title?: string;
  fields: FormField[];
  layout?: FormLayout;
}

export const GRID_COLUMNS = 4;
export const MAX_ROW_CELLS = 4;
export const MAX_TEXT_LENGTH = 10_000;
export const NON_INPUT_TYPES: FormFieldType[] = ['display', 'markdown'];
export const FIELD_TYPES: FormFieldType[] = ['string', 'textarea', 'number', 'currency', 'email', 'url',
  'select', 'radio', 'multiselect', 'checkbox-group', 'boolean', 'date', 'datetime', 'display', 'markdown', 'file'];
const TEXT_TYPES: FormFieldType[] = ['string', 'textarea', 'email', 'url'];
const CHOICE_TYPES: FormFieldType[] = ['select', 'radio', 'multiselect', 'checkbox-group'];
const MULTI_TYPES: FormFieldType[] = ['multiselect', 'checkbox-group'];
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_FORMAT = /^https?:\/\/[^\s/?#.]+\.[^\s]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCEPT = /^(\.[a-z0-9]{1,16}|[a-z]+\/(\*|[a-z0-9.+-]+))$/;
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A file field's own size limit cannot exceed this (1 GiB); the engine's configured cap still applies. */
export const MAX_FILE_SIZE = 1024 * 1024 * 1024;

/** A file id as the engine issues it on upload; a form submits ids, never the bytes. */
export const isFileId = (value: unknown): value is string => typeof value === 'string' && FILE_ID.test(value);
/** RE2 syntax a browser's RegExp reads differently; the engine refuses the same list. */
const NON_PORTABLE = ['(?P', '(?i', '(?m', '(?s', '(?U', '\\z', '\\A', '\\C', '\\Q', '[[:'];

export const isInput = (field: FormField): boolean => !NON_INPUT_TYPES.includes(field.type);
export const isMulti = (field: FormField): boolean => MULTI_TYPES.includes(field.type);
export const isChoice = (field: FormField): boolean => CHOICE_TYPES.includes(field.type);
export const isText = (field: FormField): boolean => TEXT_TYPES.includes(field.type);

export function optionsOf(field: FormField): FormOption[] {
  return (field.options ?? []).map((option) =>
    typeof option === 'string' ? { value: option, label: option } : { value: option.value, label: option.label ?? option.value });
}

/** ISO 4217 minor units; anything not listed has 2. */
const CURRENCY_SCALE: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0,
  VUV: 0, XAF: 0, XOF: 0, XPF: 0, BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};
export const currencyScale = (code?: string): number => CURRENCY_SCALE[(code ?? '').toUpperCase()] ?? 2;

/** Seeds a values map from process variables plus each field's default. */
export function formValuesFromSchema(
  schema: FormSchema,
  initialValues: Record<string, unknown> = {},
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...initialValues };
  for (const field of schema.fields ?? []) {
    if (values[field.id] === undefined && field.defaultValue !== undefined) {
      values[field.id] = field.defaultValue;
    }
  }
  return values;
}

// ---- layout -------------------------------------------------------------------------------------------

export type FormDensity = 'comfortable' | 'standard' | 'compact';

/** Short forms breathe; long forms tighten and go multi-column on wide screens. */
export function densityFor(visibleInputs: number): FormDensity {
  if (visibleInputs <= 6) return 'comfortable';
  if (visibleInputs <= 15) return 'standard';
  return 'compact';
}

/** Below this container width every field takes the full row. */
export const MOBILE_WIDTH = 520;

/** Columns of a form without layout, by density and container width. */
export function autoColumns(density: FormDensity, width: number): number {
  if (width < MOBILE_WIDTH) return 1;
  if (density === 'compact' && width >= 960) return 3;
  if (density !== 'comfortable' && width >= 640) return 2;
  return 1;
}

/** The span a new field gets, by type: a date is not full-width. */
export function defaultSpan(type: FormFieldType): number {
  switch (type) {
    case 'textarea': case 'checkbox-group': case 'markdown': return 4;
    case 'string': case 'email': case 'url': case 'radio': case 'multiselect': case 'display': case 'file': return 2;
    default: return 1;
  }
}

export const cellField = (cell: string | FormCell): string => (typeof cell === 'string' ? cell : cell.field);
export const cellSpan = (cell: string | FormCell): number =>
  Math.min(GRID_COLUMNS, Math.max(1, typeof cell === 'string' ? 1 : cell.span ?? 1));

/** The field values with process variables for visibility: form values win, missing ones are null. */
export function visibilityScope(values: Record<string, unknown>, variables: Record<string, unknown> = {}) {
  return { ...variables, ...values };
}

// ---- schema problems (deploy-time rules, shown in the designer) ----------------------------------------

/** Why the engine would refuse this form at deploy; empty when it accepts it. */
export function formProblems(schema: FormSchema): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  (schema.fields ?? []).forEach((field) => {
    const at = `'${field.label || field.id}'`;
    if (!IDENTIFIER.test(field.id ?? '')) problems.push(`${at}: the variable name must be letters, digits and _`);
    else if (ids.has(field.id)) problems.push(`${at}: the variable name '${field.id}' is used twice`);
    ids.add(field.id);
    if (!FIELD_TYPES.includes(field.type)) { problems.push(`${at}: unknown type '${field.type}'`); return; }
    if (field.required && !isInput(field)) problems.push(`${at}: a ${field.type} field cannot be required`);
    if (isChoice(field)) {
      const values = optionsOf(field).map((option) => option.value);
      if (values.length === 0 || values.some((value) => !value)) problems.push(`${at}: needs at least one non-empty option`);
      if (new Set(values).size !== values.length) problems.push(`${at}: an option is listed twice`);
    }
    if ((field.minLength != null || field.maxLength != null) && !isText(field)) problems.push(`${at}: lengths only apply to text fields`);
    if (field.minLength != null && field.maxLength != null && field.minLength > field.maxLength) problems.push(`${at}: min length is larger than max length`);
    if (field.maxLength != null && field.maxLength > MAX_TEXT_LENGTH) problems.push(`${at}: max length is at most ${MAX_TEXT_LENGTH}`);
    if (field.pattern) {
      if (field.type !== 'string' && field.type !== 'textarea') problems.push(`${at}: a pattern only applies to text fields`);
      else {
        const problem = patternProblem(field.pattern);
        if (problem) problems.push(`${at}: ${problem}`);
      }
    }
    if (field.type === 'file') {
      if (field.accept !== undefined && !Array.isArray(field.accept)) problems.push(`${at}: 'accept' is a list of extensions (.pdf) or content types (image/*)`);
      (Array.isArray(field.accept) ? field.accept : []).forEach((entry) => {
        if (typeof entry !== 'string' || !ACCEPT.test(entry.trim().toLowerCase())) problems.push(`${at}: accept entry '${entry}' is not an extension (.pdf) or a content type (image/*)`);
      });
      if (field.maxSize != null && (!Number.isInteger(field.maxSize) || field.maxSize < 1 || field.maxSize > MAX_FILE_SIZE)) {
        problems.push(`${at}: maxSize is a whole number of bytes between 1 and ${MAX_FILE_SIZE}`);
      }
    } else {
      for (const name of ['accept', 'multiple', 'maxSize'] as const) {
        if (field[name] !== undefined) problems.push(`${at}: '${name}' only applies to file fields`);
      }
    }
    if (field.min != null || field.max != null) {
      if (field.type === 'date' || field.type === 'datetime') {
        for (const bound of [field.min, field.max]) {
          if (bound != null && parseTemporal(field.type, String(bound)) === null) problems.push(`${at}: min/max must be ISO ${field.type === 'date' ? 'dates' : 'instants'}`);
        }
      } else if (!['number', 'currency', ...MULTI_TYPES].includes(field.type) && !(field.type === 'file' && field.multiple)) {
        problems.push(`${at}: min/max do not apply to a ${field.type} field`);
      } else if (typeof field.min === 'number' && typeof field.max === 'number' && field.min > field.max) {
        problems.push(`${at}: min is larger than max`);
      }
    }
    if (field.type === 'currency' && !/^[A-Z]{3}$/.test(field.currency ?? '')) problems.push(`${at}: needs a 3-letter ISO currency code`);
    if (field.type === 'display' && !IDENTIFIER.test(field.variable ?? '')) problems.push(`${at}: name the process variable it shows`);
    if (field.visible_when) {
      const problem = visibilityProblem(field.visible_when);
      if (problem) problems.push(`${at}: show-when ${problem}`);
    }
  });
  if (schema.layout) problems.push(...layoutProblems(schema.layout, ids));
  return problems;
}

export function patternProblem(pattern: string): string | null {
  if (!pattern || pattern.length > 512) return 'the pattern must be 1 to 512 characters';
  const construct = NON_PORTABLE.find((token) => pattern.includes(token));
  if (construct) return `the pattern uses '${construct}', which browsers read differently`;
  if (/\(\?[=!<]/.test(pattern) || /\\[1-9]/.test(pattern)) return 'look-around and back-references are not portable';
  try {
    new RegExp(pattern, 'u');
  } catch {
    return 'the pattern is not a valid regular expression';
  }
  return null;
}

function layoutProblems(layout: FormLayout, fieldIds: Set<string>): string[] {
  const problems: string[] = [];
  if (!Array.isArray(layout.sections) || layout.sections.length === 0) return ['the layout needs at least one section'];
  const placed = new Map<string, number>();
  const sectionIds = new Set<string>();
  layout.sections.forEach((section, s) => {
    const at = `section '${section.title || section.id || s + 1}'`;
    if (!IDENTIFIER.test(section.id ?? '')) problems.push(`${at}: id must be letters, digits and _`);
    else if (sectionIds.has(section.id)) problems.push(`${at}: id '${section.id}' is used twice`);
    sectionIds.add(section.id);
    (section.rows ?? []).forEach((row, r) => {
      if (!Array.isArray(row) || row.length === 0 || row.length > MAX_ROW_CELLS) {
        problems.push(`${at}, row ${r + 1}: a row holds 1 to ${MAX_ROW_CELLS} fields`);
        return;
      }
      const width = row.reduce((sum, cell) => sum + cellSpan(cell), 0);
      if (width > GRID_COLUMNS) problems.push(`${at}, row ${r + 1}: the widths add up to ${width}, more than ${GRID_COLUMNS}`);
      row.forEach((cell) => {
        const id = cellField(cell);
        if (!fieldIds.has(id)) problems.push(`${at}, row ${r + 1}: '${id}' is not a field of this form`);
        else placed.set(id, (placed.get(id) ?? 0) + 1);
      });
    });
  });
  fieldIds.forEach((id) => {
    const count = placed.get(id) ?? 0;
    if (count === 0) problems.push(`field '${id}' is not placed in any section`);
    if (count > 1) problems.push(`field '${id}' is placed ${count} times`);
  });
  if (layout.steps) {
    const covered = layout.steps.flatMap((step) => step.sections ?? []);
    if (layout.steps.some((step) => !step.sections?.length)) problems.push('every step lists at least one section');
    const order = layout.sections.map((section) => section.id);
    if (covered.join('|') !== order.join('|')) problems.push('steps must cover every section exactly once, in section order');
  }
  return problems;
}

// ---- submission checks (the engine's completion rules) -------------------------------------------------

export type FormRule = 'required' | 'type' | 'format' | 'pattern' | 'minLength' | 'maxLength' | 'min' | 'max'
  | 'option' | 'decimals' | 'not_submittable'
  | 'file_unknown' | 'file_not_pending' | 'file_size' | 'file_type' | 'file_total';

export interface FormViolation {
  field: string;
  rule: FormRule;
}

export interface FormCheck {
  violations: FormViolation[];
  /** Fields hidden by `visible_when`: never required, never submitted. */
  hidden: string[];
}

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/** ISO date (YYYY-MM-DD) or instant with offset as epoch millis; null when it is neither. */
export function parseTemporal(type: 'date' | 'datetime', value: string): number | null {
  if (type === 'date') {
    if (!ISO_DATE.test(value)) return null;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value ? null : time;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** The first rule a submitted value breaks, or null. */
export function ruleBroken(field: FormField, value: unknown): FormRule | null {
  switch (field.type) {
    case 'string': case 'textarea': case 'email': case 'url': {
      if (typeof value !== 'string') return 'type';
      const length = Array.from(value).length;
      if (length > MAX_TEXT_LENGTH) return 'maxLength';
      if (field.type === 'email' && !EMAIL.test(value)) return 'format';
      if (field.type === 'url' && !URL_FORMAT.test(value)) return 'format';
      if (field.minLength != null && length < field.minLength) return 'minLength';
      if (field.maxLength != null && length > field.maxLength) return 'maxLength';
      if (field.pattern) {
        try {
          if (!new RegExp(`^(?:${field.pattern})$`, 'u').test(value)) return 'pattern';
        } catch {
          return 'pattern';
        }
      }
      return null;
    }
    case 'number': case 'currency': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'type';
      if (typeof field.min === 'number' && value < field.min) return 'min';
      if (typeof field.max === 'number' && value > field.max) return 'max';
      if (field.type === 'currency') {
        const text = String(value);
        const decimals = text.includes('e-') ? Number(text.split('e-')[1]) : (text.split('.')[1] ?? '').length;
        if (decimals > currencyScale(field.currency)) return 'decimals';
      }
      return null;
    }
    case 'boolean': return typeof value === 'boolean' ? null : 'type';
    case 'select': case 'radio':
      if (typeof value !== 'string') return 'type';
      return optionsOf(field).some((option) => option.value === value) ? null : 'option';
    case 'multiselect': case 'checkbox-group': {
      if (!Array.isArray(value)) return 'type';
      const allowed = new Set(optionsOf(field).map((option) => option.value));
      if (value.some((item) => typeof item !== 'string' || !allowed.has(item)) || new Set(value).size !== value.length) return 'option';
      if (typeof field.min === 'number' && value.length < field.min) return 'min';
      if (typeof field.max === 'number' && value.length > field.max) return 'max';
      return null;
    }
    case 'file': {
      if (!field.multiple) return isFileId(value) ? null : 'type';
      if (!Array.isArray(value) || value.some((item) => !isFileId(item)) || new Set(value).size !== value.length) return 'type';
      if (typeof field.min === 'number' && value.length < field.min) return 'min';
      if (typeof field.max === 'number' && value.length > field.max) return 'max';
      return null;
    }
    case 'date': case 'datetime': {
      if (typeof value !== 'string') return 'type';
      const time = parseTemporal(field.type, value);
      if (time === null) return 'type';
      if (field.min != null && time < (parseTemporal(field.type, String(field.min)) ?? -Infinity)) return 'min';
      if (field.max != null && time > (parseTemporal(field.type, String(field.max)) ?? Infinity)) return 'max';
      return null;
    }
    default: return null;
  }
}

/**
 * The engine's completion check: `submitted` are the values posted, `current`
 * the process variables. A required field may be satisfied by the current
 * value; only submitted values are checked against their rules.
 */
export function checkSubmission(
  schema: FormSchema,
  submitted: Record<string, unknown>,
  current: Record<string, unknown> = {},
  onlyIds?: string[],
): FormCheck {
  const scope = { ...current, ...submitted };
  const violations: FormViolation[] = [];
  const hidden: string[] = [];
  for (const field of schema.fields ?? []) {
    const has = Object.prototype.hasOwnProperty.call(submitted, field.id);
    if (!isInput(field)) {
      if (has) violations.push({ field: field.id, rule: 'not_submittable' });
      continue;
    }
    if (!isVisible(field.visible_when, scope)) {
      hidden.push(field.id);
      continue;
    }
    if (onlyIds && !onlyIds.includes(field.id)) continue;
    const value = has ? submitted[field.id] : scope[field.id];
    const empty = isEmpty(value);
    if (empty || (field.type === 'boolean' && field.required && value !== true)) {
      if (field.required) violations.push({ field: field.id, rule: 'required' });
      if (empty) continue;
    }
    if (!has) continue;
    const rule = ruleBroken(field, value);
    if (rule) violations.push({ field: field.id, rule });
  }
  return { violations, hidden };
}

/** A sentence for a broken rule, for the person filling the form. */
export function ruleMessage(field: FormField, rule: FormRule): string {
  const label = field.label || field.id;
  const unit = (n: unknown) => (field.type === 'currency' && field.currency ? `${field.currency} ${n}` : String(n));
  switch (rule) {
    case 'required': return field.type === 'boolean' ? `${label} must be checked` : `${label} is required`;
    case 'type':
      if (field.type === 'number' || field.type === 'currency') return `${label} must be a number`;
      if (field.type === 'date') return `${label} must be a date`;
      if (field.type === 'datetime') return `${label} must be a date and time`;
      if (field.type === 'file') return `Upload the file for ${label} again`;
      return `${label} has the wrong kind of value`;
    case 'format': return field.type === 'email' ? 'Enter an email address like name@company.com' : 'Enter a full address starting with https://';
    case 'pattern': return `${label} is not in the expected format`;
    case 'minLength': return `At least ${field.minLength} characters`;
    case 'maxLength': return `At most ${field.maxLength ?? MAX_TEXT_LENGTH} characters`;
    case 'min': if (field.type === 'file') return `Add at least ${field.min} file${field.min === 1 ? '' : 's'}`;
      return isMulti(field) ? `Pick at least ${field.min}` : field.type === 'date' || field.type === 'datetime'
      ? `On or after ${field.min}` : `At least ${unit(field.min)}`;
    case 'max': if (field.type === 'file') return `At most ${field.max} file${field.max === 1 ? '' : 's'}`;
      return isMulti(field) ? `Pick at most ${field.max}` : field.type === 'date' || field.type === 'datetime'
      ? `On or before ${field.max}` : `At most ${unit(field.max)}`;
    case 'option': return 'Choose one of the listed options';
    case 'decimals': return `At most ${currencyScale(field.currency)} decimals`;
    case 'not_submittable': return `${label} is shown only`;
    case 'file_unknown': case 'file_not_pending': return `Upload the file for ${label} again`;
    case 'file_size': return `A file in ${label} is too large`;
    case 'file_type': return `A file in ${label} is not an accepted type`;
    case 'file_total': return 'The files of this task are too large together';
    default: return `${label} is not valid`;
  }
}

/** Messages by field id for a set of violations (from the browser or from the engine's 422). */
export function violationMessages(schema: FormSchema, violations: FormViolation[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const violation of violations) {
    const field = schema.fields.find((candidate) => candidate.id === violation.field);
    if (field && !errors[field.id]) errors[field.id] = ruleMessage(field, violation.rule);
  }
  return errors;
}

/**
 * Per-field validation messages for the values in the form; empty object means
 * the form is valid. `onlyIds` limits the check to one wizard step.
 */
export function validateForm(
  schema: FormSchema,
  values: Record<string, unknown>,
  options: { variables?: Record<string, unknown>; onlyIds?: string[] } = {},
): Record<string, string> {
  const submitted = submittedValues(schema, values, options.variables);
  const { violations } = checkSubmission(schema, submitted, { ...options.variables, ...values }, options.onlyIds);
  return violationMessages(schema, violations);
}

/**
 * The values to post on completion: the form's visible inputs only. Process
 * variables the inbox seeded the form with are not re-posted, and hidden
 * fields are left out (the engine would discard them).
 */
export function submittedValues(
  schema: FormSchema,
  values: Record<string, unknown>,
  variables: Record<string, unknown> = {},
): Record<string, unknown> {
  const scope = visibilityScope(values, variables);
  const out: Record<string, unknown> = {};
  for (const field of schema.fields ?? []) {
    if (!isInput(field) || !isVisible(field.visible_when, scope)) continue;
    if (!Object.prototype.hasOwnProperty.call(values, field.id) || values[field.id] === undefined) continue;
    // A file field posts the ids of new uploads only; references already in the process stay as they are.
    if (field.type === 'file' && !(field.multiple ? Array.isArray(values[field.id]) && (values[field.id] as unknown[]).every(isFileId)
      : isFileId(values[field.id]))) continue;
    out[field.id] = values[field.id];
  }
  return out;
}
