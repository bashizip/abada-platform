/** Files as agent input (S15): what the Studio can tell an author about `files`. */
import { useEffect, useState } from 'react';
import { ProjectAPI } from '@/api/projects';
import type { FormSchema } from '@/features/inbox/formSchema';

/** The content types a model can read, by provider family, as the agent worker sends them. */
export const AGENT_FILE_TYPES: ReadonlyArray<{ types: string; providers: string }> = [
  { types: 'PNG, JPEG, WebP images', providers: 'Gemini, OpenAI, OpenRouter, Anthropic and most self-hosted vision models' },
  { types: 'PDF', providers: 'Gemini, OpenAI and OpenRouter (not Anthropic through its OpenAI-compatible API)' },
];

/** Default and bounds of `max_files`. */
export const MAX_FILES_DEFAULT = 5;
export const MAX_FILES_LIMIT = 20;

export interface FileFieldOption {
  /** The variable the field writes: its id. */
  id: string;
  label: string;
  formKey: string;
  multiple: boolean;
}

function decode(content: string): string {
  const bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The file fields of a form schema. */
export function fileFields(formKey: string, schema: FormSchema): FileFieldOption[] {
  return (schema.fields ?? [])
    .filter((field) => field.type === 'file')
    .map((field) => ({
      id: field.id,
      label: field.label || field.id,
      formKey,
      multiple: Boolean((field as { multiple?: boolean }).multiple),
    }));
}

/** A free name for a new file entry: `document`, `document_2`, ... */
export function nextFileName(existing: Record<string, string>): string {
  let name = 'document';
  for (let n = 2; name in existing; n++) name = `document_${n}`;
  return name;
}

/**
 * The file fields of the task forms the process uses, to suggest the variable a
 * `files` entry reads. Forms that cannot be loaded are skipped: suggestions only.
 */
export function useFileFieldOptions(projectId: string | undefined, formKeys: string[]): FileFieldOption[] {
  const [options, setOptions] = useState<FileFieldOption[]>([]);
  const key = [...new Set(formKeys)].sort().join('|');
  useEffect(() => {
    if (!projectId || !key) {
      setOptions([]);
      return undefined;
    }
    let cancelled = false;
    Promise.all(key.split('|').map(async (formKey) => {
      try {
        const resource = await ProjectAPI.resolveForm(projectId, formKey);
        return fileFields(formKey, JSON.parse(decode(resource.contentBase64)) as FormSchema);
      } catch {
        return [];
      }
    })).then((lists) => {
      if (!cancelled) setOptions(lists.flat());
    });
    return () => { cancelled = true; };
  }, [projectId, key]);
  return options;
}
