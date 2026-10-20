import React, { useContext, useEffect, useRef, useState } from 'react';
import { Eye, FileText, Loader2, Upload, X } from 'lucide-react';
import { FileUploadError, formatBytes } from '@/api/files';
import type { ProcessFile } from '@/api/files';
import { isFileReference, type FileReference } from '@/components/json/jsonModel';
import { FormDensity, FormField, isFileId } from './formSchema';
import { DEFAULT_MAX_FILE_BYTES, FormFilesContext, preUploadProblem } from './fileFieldModel';

const previewable = (contentType: string): boolean => contentType.startsWith('image/') && contentType !== 'image/svg+xml'
  || contentType === 'application/pdf';

const UPLOAD_MESSAGES: Record<string, string> = {
  size: 'is larger than this field allows',
  task_total: 'would make the files of this task too large together',
  accept: 'is not a type this field accepts',
  type_mismatch: "has contents that do not match its name",
  executable: 'is a program; programs are not accepted',
  empty: 'is empty',
};

interface Upload {
  key: string;
  name: string;
  progress: number;
  controller: AbortController;
}

/** The ids or references the field holds, as a list. */
function entries(value: unknown): (string | FileReference)[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
  return list.filter((item): item is string | FileReference => isFileId(item) || isFileReference(item));
}

export const FileField: React.FC<{
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  density: FormDensity;
  invalid: boolean;
  describedBy?: string;
}> = ({ field, value, onChange, readOnly, density, invalid, describedBy }) => {
  const files = useContext(FormFilesContext);
  const input = useRef<HTMLInputElement>(null);
  const [known, setKnown] = useState<Record<string, ProcessFile>>({});
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string; contentType: string } | null>(null);
  const current = entries(value);
  const latest = useRef(current);
  latest.current = current;

  useEffect(() => () => uploads.forEach((upload) => upload.controller.abort()), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const disabled = readOnly || !files;
  const id = `field-${field.id}`;

  const accept = async (picked: File[]) => {
    if (!files || disabled) return;
    const chosen = field.multiple ? picked : picked.slice(0, 1);
    const refused: string[] = [];
    const ready = chosen.filter((file) => {
      const problem = preUploadProblem(field, file);
      if (problem) refused.push(problem);
      return !problem;
    });
    if (field.multiple && typeof field.max === 'number') {
      const room = Math.max(0, field.max - latest.current.filter(isFileId).length);
      if (ready.length > room) refused.push(`At most ${field.max} files`);
      ready.splice(room);
    }
    setProblems(refused);
    for (const file of ready) {
      const upload: Upload = { key: `${file.name}-${Date.now()}-${Math.random()}`, name: file.name, progress: 0, controller: new AbortController() };
      setUploads((list) => [...list, upload]);
      try {
        const stored = await files.upload(field.id, file, (fraction) =>
          setUploads((list) => list.map((item) => (item.key === upload.key ? { ...item, progress: fraction } : item))), upload.controller.signal);
        setKnown((map) => ({ ...map, [stored.fileId]: stored }));
        if (field.multiple) {
          // References already in the process are replaced by the new uploads.
          onChange([...latest.current.filter(isFileId), stored.fileId]);
        } else {
          const previous = latest.current.find(isFileId);
          if (previous) files.discard(previous).catch(() => undefined);
          onChange(stored.fileId);
        }
      } catch (error) {
        if (error instanceof FileUploadError && error.reason === 'cancelled') continue;
        const reason = error instanceof FileUploadError && error.reason ? UPLOAD_MESSAGES[error.reason] : undefined;
        setProblems((list) => [...list, reason ? `${file.name} ${reason}` : `${file.name}: ${(error as Error).message}`]);
      } finally {
        setUploads((list) => list.filter((item) => item.key !== upload.key));
      }
    }
  };

  const remove = (fileId: string) => {
    if (!files) return;
    files.discard(fileId).catch(() => undefined);
    const rest = latest.current.filter((item) => item !== fileId);
    onChange(field.multiple ? (rest.length ? rest : undefined) : undefined);
  };

  const open = async (fileId: string, name: string, contentType: string) => {
    if (!files) return;
    try {
      const blob = await files.read(fileId);
      setPreview({ url: URL.createObjectURL(blob), name, contentType });
    } catch (error) {
      setProblems([`${name}: ${(error as Error).message}`]);
    }
  };

  const hint = [
    field.accept?.length ? field.accept.join(', ') : 'any file',
    `up to ${formatBytes(field.maxSize ?? DEFAULT_MAX_FILE_BYTES)}`,
    field.multiple && typeof field.max === 'number' ? `${field.max} files` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="grid min-w-0 gap-1.5" data-file-field={field.id}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        id={id}
        aria-disabled={disabled || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => !disabled && input.current?.click()}
        onKeyDown={(event) => {
          if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(event) => { if (!disabled) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void accept(Array.from(event.dataTransfer.files));
        }}
        className={`flex min-w-0 items-center gap-2 rounded-md border border-dashed px-2.5 text-[12px] transition-colors ${
          density === 'compact' ? 'min-h-8 py-1' : 'min-h-10 py-1.5'} ${
          disabled ? 'cursor-not-allowed border-hairline text-sand-dim opacity-70'
            : dragging ? 'cursor-copy border-mineral-teal bg-mineral-teal/10 text-linen'
              : invalid ? 'cursor-pointer border-desert-rose text-sand hover:text-linen'
                : 'cursor-pointer border-hairline-strong text-sand hover:border-mineral-teal hover:text-linen'}`}>
        <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="shrink-0">
          {!files ? 'Files are uploaded when the task is filled in' : field.multiple ? 'Drop files or browse' : 'Drop a file or browse'}
        </span>
        <span className="ml-auto min-w-0 truncate text-right text-[10.5px] text-sand-dim" title={hint}>{hint}</span>
        <input ref={input} type="file" className="hidden" multiple={field.multiple} tabIndex={-1}
          accept={field.accept?.join(',')} disabled={disabled}
          onChange={(event) => {
            void accept(Array.from(event.target.files ?? []));
            event.target.value = '';
          }} />
      </div>

      {(current.length > 0 || uploads.length > 0) && (
        <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={`${field.label || field.id} files`}>
          {current.map((item) => {
            const fileId = typeof item === 'string' ? item : item.fileId;
            const meta = typeof item === 'string' ? known[item] : item;
            const name = meta?.name ?? 'Uploaded file';
            const contentType = meta?.contentType ?? '';
            const fresh = typeof item === 'string';
            return (
              <li key={fileId} className="flex min-w-0 max-w-full items-center gap-1 rounded-control border border-hairline bg-mocha-deep px-1.5 text-[11px] leading-[20px] text-linen-muted">
                <FileText className="h-3 w-3 shrink-0 text-sand" aria-hidden="true" />
                <span className="min-w-0 truncate" title={name}>{name}</span>
                {meta && <span className="shrink-0 text-sand">· {formatBytes(meta.size)}</span>}
                {!fresh && <span className="shrink-0 text-sand-dim">· in the process</span>}
                {files && previewable(contentType) && (
                  <button type="button" onClick={() => void open(fileId, name, contentType)} aria-label={`Preview ${name}`}
                    className="shrink-0 text-sand hover:text-linen"><Eye className="h-3 w-3" /></button>
                )}
                {fresh && !readOnly && files && (
                  <button type="button" onClick={() => remove(fileId)} aria-label={`Remove ${name}`}
                    className="shrink-0 text-sand hover:text-desert-rose"><X className="h-3 w-3" /></button>
                )}
              </li>
            );
          })}
          {uploads.map((upload) => (
            <li key={upload.key} className="flex min-w-0 max-w-full items-center gap-1.5 rounded-control border border-hairline px-1.5 text-[11px] leading-[20px] text-sand"
              aria-live="polite">
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
              <span className="min-w-0 truncate">{upload.name}</span>
              <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-hairline" role="progressbar"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(upload.progress * 100)}>
                <i className="block h-full bg-mineral-teal" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
              </span>
              <button type="button" onClick={() => upload.controller.abort()} aria-label={`Cancel ${upload.name}`}
                className="shrink-0 hover:text-desert-rose"><X className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
      )}

      {problems.length > 0 && (
        <ul className="grid gap-0.5" role="alert">
          {problems.map((problem) => <li key={problem} className="text-[11px] leading-snug text-desert-rose">{problem}</li>)}
        </ul>
      )}

      {preview && (
        <div role="dialog" aria-modal="true" aria-label={`Preview of ${preview.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/80 p-4"
          onClick={() => setPreview(null)} onKeyDown={(event) => event.key === 'Escape' && setPreview(null)}>
          <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-hairline bg-mocha"
            onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-[12.5px] text-linen">
              <span className="min-w-0 truncate">{preview.name}</span>
              <button type="button" autoFocus onClick={() => setPreview(null)} aria-label="Close preview"
                className="ml-auto text-sand hover:text-linen"><X className="h-4 w-4" /></button>
            </div>
            {preview.contentType === 'application/pdf' ? (
              // Not sandboxed: browsers do not render PDFs in sandboxed frames. The blob is the engine's bytes, served as a PDF.
              <iframe title={preview.name} src={preview.url} className="min-h-0 flex-1 bg-white" />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
                <img src={preview.url} alt={preview.name} className="max-h-full max-w-full object-contain" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
