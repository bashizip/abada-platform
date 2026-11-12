import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttons, byLabel, click, render, type } from '@/test/render';
import type { AgentConfig, WorkflowNode } from '@/types';
import { fileFields, nextFileName } from '@/lib/agentFiles';
import { AgentFilesEditor } from './AgentFilesEditor';

const api = vi.hoisted(() => ({ resolveForm: vi.fn() }));
vi.mock('@/api/projects', () => ({ ProjectAPI: api }));
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

const form = {
  title: 'Declaration upload',
  fields: [
    { id: 'bordereau_scan', type: 'file', label: 'Scanned declaration' },
    { id: 'annexes', type: 'file', label: 'Annexes', multiple: true },
    { id: 'employer', type: 'string', label: 'Employer' },
  ],
};
const encoded = btoa(JSON.stringify(form));
const nodes = [{ id: 'depot', type: 'human', humanConfig: { formKey: 'declaration-depot' } }] as unknown as WorkflowNode[];
const base: AgentConfig = { model: 'gemini-3.6-flash', systemPrompt: 'Read it', confidenceThreshold: 0, temperature: 0.2, tools: [] };

describe('agent files editor', () => {
  it('suggests the file fields of the process forms and adds a file reading the first one', async () => {
    api.resolveForm.mockResolvedValue({ contentBase64: encoded });
    const patch = vi.fn();
    const container = render(<AgentFilesEditor config={base} nodes={nodes} projectId="p" issues={[]} patch={patch} />);
    await settle();

    expect(api.resolveForm).toHaveBeenCalledWith('p', 'declaration-depot');
    const options = [...container.querySelectorAll('datalist option')].map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(['bordereau_scan', 'annexes']);
    expect(container.textContent).not.toContain('Most files per call');

    click(buttons(container).find((button) => button.textContent?.includes('Add file'))!);
    expect(patch).toHaveBeenLastCalledWith({ files: { document: 'bordereau_scan' }, maxFiles: undefined });
  });

  it('edits a file, shows the limit and the accepted types, and drops max_files with the last file', async () => {
    api.resolveForm.mockResolvedValue({ contentBase64: encoded });
    const patch = vi.fn();
    const config = { ...base, files: { bordereau: 'bordereau_scan' }, maxFiles: 2 };
    const container = render(<AgentFilesEditor config={config} nodes={nodes} projectId="p" issues={[]} patch={patch} />);
    await settle();

    expect(container.textContent).toContain('Most files per call');
    expect(container.textContent).toContain('PDF');
    type(byLabel<HTMLInputElement>(container, 'File variable bordereau')!, 'scans');
    expect(patch).toHaveBeenLastCalledWith({ files: { bordereau: 'scans' }, maxFiles: 2 });

    click(byLabel(container, 'Remove file bordereau')!);
    expect(patch).toHaveBeenLastCalledWith({ files: undefined, maxFiles: undefined });
  });

  it('shows the engine issue on files', async () => {
    api.resolveForm.mockRejectedValue(new Error('no form'));
    const container = render(<AgentFilesEditor config={{ ...base, files: { doc: 'x' } }} nodes={nodes} projectId="p"
      issues={[{ code: 'ABADA-APL-VALIDATION-001', severity: 'ERROR', message: "agent node 'lecture' declares 'doc' both in inputs and in files",
        path: '/flow/nodes/1/files/doc', elementId: 'lecture' } as never]} patch={vi.fn()} />);
    await settle();
    expect(container.querySelectorAll('datalist option')).toHaveLength(0);
    expect(container.textContent).toContain('both in inputs and in files');
  });
});

describe('agent file helpers', () => {
  it('lists file fields and picks a free name', () => {
    expect(fileFields('f', form as never).map((field) => [field.id, field.multiple])).toEqual([
      ['bordereau_scan', false], ['annexes', true]]);
    expect(nextFileName({})).toBe('document');
    expect(nextFileName({ document: 'a', document_2: 'b' })).toBe('document_3');
  });
});
