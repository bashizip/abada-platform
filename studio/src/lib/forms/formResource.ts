import type { FormSchema } from '@/features/inbox/formSchema';

/** A form key from a free-text title: lowercase, dash-separated, never empty. */
export function slugify(value: string): string {
  const slug = value.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return slug || 'new-form';
}

/** UTF-8 safe base64 of a JSON string, as the resource API expects. */
export function b64of(json: string): string {
  const bytes = new TextEncoder().encode(json);
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/** The starting point of a form created from scratch in the designer. */
export const emptyFormSchema = (): FormSchema => ({ title: 'New form', fields: [] });

/** File name and content of a form resource saved under forms/. */
export function formResourceOf(schema: FormSchema): { name: string; contentBase64: string } {
  return {
    name: `${slugify(schema.title || 'new-form')}.json`,
    contentBase64: b64of(JSON.stringify(schema, null, 2)),
  };
}
