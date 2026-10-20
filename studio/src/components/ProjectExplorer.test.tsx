import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttons, byLabel, click, render } from '@/test/render';
import type { ProjectTreeNode } from '@/api/projects';

const tree: ProjectTreeNode[] = [{
  id: 'forms-root', kind: 'FOLDER', name: 'forms', fileName: null, processKey: null,
  contentType: null, status: null, path: 'forms', revision: 0, system: true, children: [],
}];

const createResource = vi.fn(async () => ({ id: 'r1' }));

vi.mock('@/api/projects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/projects')>();
  return {
    ...actual,
    ProjectAPI: {
      tree: vi.fn(async () => tree),
      createResource,
    },
  };
});

const { ProjectExplorer } = await import('./ProjectExplorer');

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

afterEach(() => { document.body.innerHTML = ''; createResource.mockClear(); });

const renderExplorer = async () => {
  const container = render(<ProjectExplorer projectId="p1" activeWorkflowId={undefined} workflows={[]}
    onSelectWorkflow={() => undefined} onActivateWorkflow={() => undefined}
    onRemoveDocument={() => undefined} onNewWorkflow={() => undefined} />);
  await settle();
  return container;
};

describe('project explorer forms folder', () => {
  it('creates a form from a blank designer, without importing a file', async () => {
    const container = await renderExplorer();
    click(byLabel(container, 'New form'));
    expect(document.body.textContent).toContain('new form in forms/');
    expect(document.body.textContent).not.toContain('Import File');

    const save = buttons(document.body).find((button) => button.textContent?.includes('Save form'))!;
    click(save);
    await settle();

    expect(createResource).toHaveBeenCalledWith('p1', 'new-form.json', 'FORM', 'application/json',
      expect.any(String), 'forms-root');
    expect(document.body.textContent).not.toContain('new form in forms/');
  });

  it('keeps importing a form JSON file as a separate action', async () => {
    const container = await renderExplorer();
    click(byLabel(container, 'Import form JSON'));
    expect(document.body.textContent).toContain('Import File into forms/');
  });
});
