import { config } from '@/config/runtime';
import { apiError, authenticatedFetch, freshToken } from './authenticatedFetch';

/**
 * Files of human-task forms (M5 S9). The engine stores the bytes in RustFS and
 * keeps the metadata; every read goes through the engine, so its permissions
 * and audit apply. A form value is the file id; once the task is completed the
 * process variable holds a reference `{ fileId, name, contentType, size, sha256 }`.
 */
export interface ProcessFile {
  fileId: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
  state: 'PENDING' | 'ATTACHED' | 'DELETING';
  createdAt: string;
}

/** A refused upload: `reason` is the engine's rule (size, task_total, accept, type_mismatch, executable…). */
export class FileUploadError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: string) {
    super(message);
  }
}

const projectBase = (projectId: string) => `${config.apiUrl}/v1/projects/${encodeURIComponent(projectId)}`;

/** Uploads one file to a task's file field, reporting progress from 0 to 1. */
export function uploadTaskFile(
  projectId: string,
  taskId: string,
  fieldId: string,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ProcessFile> {
  const url = `${projectBase(projectId)}/tasks/${encodeURIComponent(taskId)}/files?field=${encodeURIComponent(fieldId)}`
    + `&name=${encodeURIComponent(file.name)}`;
  return freshToken().then((token) => new Promise<ProcessFile>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status === 201) {
        resolve(JSON.parse(request.responseText) as ProcessFile);
        return;
      }
      let message = `Upload failed (${request.status})`;
      let reason: string | undefined;
      try {
        const payload = JSON.parse(request.responseText) as { message?: string; details?: { reason?: string } };
        if (payload.message) message = payload.message;
        reason = payload.details?.reason;
      } catch {
        // Not a typed error: keep the status.
      }
      reject(new FileUploadError(message, request.status, reason));
    };
    request.onerror = () => reject(new FileUploadError('The upload did not reach the engine', 0));
    request.onabort = () => reject(new FileUploadError('Upload cancelled', 0, 'cancelled'));
    signal?.addEventListener('abort', () => request.abort());
    request.send(file);
  }));
}

/** Removes a file that has not been submitted yet. */
export async function discardFile(projectId: string, fileId: string): Promise<void> {
  const response = await authenticatedFetch(`${projectBase(projectId)}/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw await apiError(response);
}

/** The file's bytes, read through the engine (audited). */
export async function fetchFileBlob(projectId: string, fileId: string): Promise<Blob> {
  const response = await authenticatedFetch(`${projectBase(projectId)}/files/${encodeURIComponent(fileId)}`);
  if (response.status === 410) throw new Error('The file is no longer available in file storage');
  if (!response.ok) throw await apiError(response);
  return response.blob();
}

/** Saves a file under its name. */
export async function downloadFile(projectId: string, fileId: string, name: string): Promise<void> {
  const blob = await fetchFileBlob(projectId, fileId);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const formatBytes = (size: number): string =>
  size < 1024 ? `${size} B` : size < 1_048_576 ? `${Math.round(size / 1024)} kB` : `${(size / 1_048_576).toFixed(1)} MB`;
