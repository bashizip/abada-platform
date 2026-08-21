/**
 * Canonical task-form schema shared by the Studio form builder, the Task Inbox
 * renderer and any other form consumer. A form is a plain JSON project
 * resource (kind FORM); the schema below is the contract for that JSON.
 *
 * `field.id` IS the process-variable name: every renderer binds values by
 * `id`, never by label.
 */
export type FormFieldType = 'string' | 'number' | 'boolean' | 'select' | 'textarea' | 'date';

export interface FormField {
  /** Process-variable name this field binds to (unique within the form). */
  id: string;
  type: FormFieldType;
  label: string;
  required?: boolean;
  /** For `select` fields. */
  options?: string[];
  /** Pre-filled value used when the variable is not yet set. */
  defaultValue?: unknown;
  placeholder?: string;
}

export interface FormSchema {
  title?: string;
  fields: FormField[];
}

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

/** Per-field validation messages; empty object means the form is valid. */
export function validateForm(
  schema: FormSchema,
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of schema.fields ?? []) {
    const raw = values[field.id];
    const empty = raw === undefined || raw === null || raw === '';
    if (field.required && empty) {
      errors[field.id] = `${field.label || field.id} is required`;
      continue;
    }
    if (empty) continue;
    if (field.type === 'number' && typeof raw === 'string') {
      if (Number.isNaN(Number(raw))) {
        errors[field.id] = `${field.label || field.id} must be a number`;
      }
    } else if (field.type === 'number' && typeof raw === 'number' && Number.isNaN(raw)) {
      errors[field.id] = `${field.label || field.id} must be a number`;
    }
  }
  return errors;
}
