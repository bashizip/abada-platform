import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessFile } from '@/api/files';
import { FormRenderer } from './FormRenderer';
import { FormFiles, FormFilesContext, acceptsFile, preUploadProblem } from './fileFieldModel';
import { FormField, FormSchema, submittedValues } from './formSchema';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID_1 = '3f2b8c1e-0d4a-4e7b-9c55-1a2b3c4d5e6f';
const ID_2 = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const certificate: FormField = { id: 'certificate', type: 'file', label: 'Certificate', accept: ['.pdf', 'image/*'], maxSize: 1000 };
const documents: FormField = { id: 'documents', type: 'file', label: 'Documents', multiple: true, max: 2 };
const schema: FormSchema = { fields: [certificate, documents] };

const stored = (fileId: string, name: string, size = 10): ProcessFile => ({
  fileId, name, contentType: 'application/pdf', size, sha256: 'x'.repeat(64), state: 'PENDING', createdAt: '2026-10-20T10:00:00Z',
});

function render(element: React.ReactElement): { root: Root; container: HTMLDivElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(element); });
  return { root, container };
}

const drop = async (container: HTMLElement, fieldId: string, files: File[]) => {
  const zone = container.querySelector(`[data-file-field="${fieldId}"] [role="button"]`) as HTMLElement;
  const event = new Event('drop', { bubbles: true }) as Event & { dataTransfer: { files: File[] } };
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  await act(async () => { zone.dispatchEvent(event); });
};

describe('file field checks before upload', () => {
  it('matches extensions, types and wildcards as the engine does', () => {
    expect(acceptsFile(['.pdf'], { name: 'A.PDF', type: '' })).toBe(true);
    expect(acceptsFile(['image/*'], { name: 'scan.png', type: 'image/png' })).toBe(true);
    expect(acceptsFile(['.pdf', 'image/*'], { name: 'notes.docx', type: '' })).toBe(false);
    expect(acceptsFile(undefined, { name: 'anything.bin', type: '' })).toBe(true);
  });

  it('says why a file would be refused', () => {
    expect(preUploadProblem(certificate, { name: 'big.pdf', type: 'application/pdf', size: 5000 })).toContain('the limit is');
    expect(preUploadProblem(certificate, { name: 'notes.txt', type: 'text/plain', size: 10 })).toContain('not accepted');
    expect(preUploadProblem(certificate, { name: 'ok.pdf', type: 'application/pdf', size: 10 })).toBeNull();
  });

  it('submits the ids of new uploads only, never references already in the process', () => {
    const reference = { fileId: ID_1, name: 'old.pdf', contentType: 'application/pdf', size: 4 };
    expect(submittedValues(schema, { certificate: reference, documents: [ID_1, ID_2] })).toEqual({ documents: [ID_1, ID_2] });
    expect(submittedValues(schema, { certificate: ID_2 })).toEqual({ certificate: ID_2 });
  });
});

describe('FileField', () => {
  it('uploads a dropped file, shows its progress and puts its id in the form', async () => {
    let finish: (file: ProcessFile) => void = () => undefined;
    const files: FormFiles = {
      upload: vi.fn((_field, _file, onProgress) => new Promise<ProcessFile>((resolve) => {
        onProgress(0.5);
        finish = resolve;
      })),
      discard: vi.fn(async () => undefined),
      read: vi.fn(async () => new Blob()),
    };
    const onChange = vi.fn();
    const Harness: React.FC = () => {
      const [values, setValues] = React.useState<Record<string, unknown>>({});
      return (
        <FormFilesContext.Provider value={files}>
          <FormRenderer schema={schema} values={values} onChange={(next) => { setValues(next); onChange(next); }} width={900} />
        </FormFilesContext.Provider>
      );
    };
    const { container, root } = render(<Harness />);
    await drop(container, 'certificate', [new File(['%PDF-'], 'cert.pdf', { type: 'application/pdf' })]);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    await act(async () => { finish(stored(ID_1, 'cert.pdf')); });
    expect(onChange).toHaveBeenLastCalledWith({ certificate: ID_1 });
    expect(container.textContent).toContain('cert.pdf');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();

    // Remove before submit: the engine is told, the value is cleared.
    await act(async () => { (container.querySelector('[aria-label="Remove cert.pdf"]') as HTMLButtonElement).click(); });
    expect(files.discard).toHaveBeenCalledWith(ID_1);
    expect(onChange).toHaveBeenLastCalledWith({ certificate: undefined });
    act(() => root.unmount());
  });

  it('refuses a file before sending it and explains why', async () => {
    const files: FormFiles = { upload: vi.fn(), discard: vi.fn(), read: vi.fn() };
    const { container, root } = render(
      <FormFilesContext.Provider value={files}>
        <FormRenderer schema={schema} values={{}} onChange={() => undefined} width={900} />
      </FormFilesContext.Provider>,
    );
    await drop(container, 'certificate', [new File(['hello'], 'notes.txt', { type: 'text/plain' })]);
    expect(files.upload).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('notes.txt is not accepted here');
    act(() => root.unmount());
  });

  it('shows references already in the process and needs a task to upload', () => {
    const reference = { fileId: ID_1, name: 'previous.pdf', contentType: 'application/pdf', size: 2048 };
    const { container, root } = render(<FormRenderer schema={schema} values={{ certificate: reference }} width={900} />);
    expect(container.textContent).toContain('previous.pdf');
    expect(container.textContent).toContain('in the process');
    expect(container.textContent).toContain('Files are uploaded when the task is filled in');
    expect(container.querySelector('[aria-label="Remove previous.pdf"]')).toBeNull();
    act(() => root.unmount());
  });
});
