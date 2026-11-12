import { createContext } from 'react';
import { formatBytes, type ProcessFile } from '@/api/files';
import type { FormField } from './formSchema';

/**
 * What a file field needs from the task it belongs to (M5 S9): upload to the
 * task's field, remove a file not yet submitted, read one for a preview. The
 * task inbox provides it; without it (the designer preview) the field shows
 * where uploads happen.
 */
export interface FormFiles {
  upload: (fieldId: string, file: File, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<ProcessFile>;
  discard: (fileId: string) => Promise<void>;
  read: (fileId: string) => Promise<Blob>;
}

export const FormFilesContext = createContext<FormFiles | null>(null);

/** The engine's cap when a field sets none (ABADA_FILES_MAX_FILE_BYTES default). */
export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain',
};

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/** The browser's guess at a file's type, for feedback before upload; the engine sniffs the bytes. */
export function acceptsFile(accept: string[] | undefined, file: { name: string; type: string }): boolean {
  if (!accept || accept.length === 0) return true;
  const extension = extensionOf(file.name);
  const type = (file.type || EXTENSION_TYPES[extension] || '').toLowerCase();
  return accept.some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (rule.startsWith('.')) return rule.slice(1) === extension;
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return rule === type;
  });
}

/** Why a file would be refused before it is sent, or null. */
export function preUploadProblem(field: FormField, file: { name: string; type: string; size: number }): string | null {
  const cap = field.maxSize ?? DEFAULT_MAX_FILE_BYTES;
  if (file.size === 0) return `${file.name} is empty`;
  if (file.size > cap) return `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(cap)}`;
  if (!acceptsFile(field.accept, file)) return `${file.name} is not accepted here (${(field.accept ?? []).join(', ')})`;
  return null;
}
