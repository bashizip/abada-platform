import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectAPI, type Project, type ProjectDocument, type ProjectTreeNode } from '@/api/projects';
import {
  ensureLeadTriageStarter,
  LEAD_TRIAGE_APL,
  STARTER_PROCESS_KEY,
  STARTER_PROJECT_SLUG,
} from './leadTriage';
import { aplToWorkflow, parseAPLYaml } from '@/lib/apl/parser';

const project: Project = {
  id: 'project-1', slug: STARTER_PROJECT_SLUG, name: 'Abada Starter', description: '',
  status: 'ACTIVE', version: 0, processCount: 1,
  currentUserRoles: ['OWNER'], currentUserReviewLanes: [],
};

const tree: ProjectTreeNode[] = ['processes', 'forms'].map((name) => ({
  id: `${name}-folder`, kind: 'FOLDER', name, fileName: null, processKey: null,
  contentType: null, status: null, path: `/${name}`, revision: 0, system: true, children: [],
}));

const document: ProjectDocument = {
  id: 'document-1', projectId: project.id, processKey: STARTER_PROCESS_KEY,
  name: 'AI Lead Triage', description: '', aplSource: LEAD_TRIAGE_APL,
  status: 'ACTIVE', revision: 0, updatedAt: '2026-09-01T00:00:00Z',
  folderId: 'processes-folder', fileName: 'lead-triage.apl.yaml',
};

const ownerMember = {
  principalId: 'principal-1', username: 'alice', principalType: 'HUMAN' as const,
  roles: ['OWNER'] as const, reviewLanes: [], taskGroups: [], version: 0,
};

const mockMembership = () => {
  vi.spyOn(ProjectAPI, 'members').mockResolvedValue([{ ...ownerMember, roles: [...ownerMember.roles] }]);
  vi.spyOn(ProjectAPI, 'putMember').mockResolvedValue({
    ...ownerMember, roles: ['OWNER', 'REVIEWER'],
  });
};

afterEach(() => vi.restoreAllMocks());

describe('Lead Triage starter', () => {
  it('produces a non-overlapping left-to-right diagram', () => {
    const workflow = aplToWorkflow(parseAPLYaml(LEAD_TRIAGE_APL));
    const positions = workflow.nodes.map((node) => `${node.x}:${node.y}`);
    expect(new Set(positions).size).toBe(workflow.nodes.length);
    const start = workflow.nodes.find((node) => node.id === 'receive-lead')!;
    const end = workflow.nodes.find((node) => node.id === 'done')!;
    expect(start.x).toBeLessThan(end.x);
  });

  it('creates, deploys and then returns the starter project', async () => {
    vi.spyOn(ProjectAPI, 'create').mockResolvedValue(project);
    vi.spyOn(ProjectAPI, 'tree').mockResolvedValue(tree);
    vi.spyOn(ProjectAPI, 'documents')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...document, lastDeploymentId: 'deployment-1' }]);
    vi.spyOn(ProjectAPI, 'createResource').mockResolvedValue({} as never);
    vi.spyOn(ProjectAPI, 'createDocument').mockResolvedValue(document);
    vi.spyOn(ProjectAPI, 'deployDocument').mockResolvedValue({
      projectId: project.id, processKey: STARTER_PROCESS_KEY, deploymentId: 'deployment-1', version: 1,
    });
    vi.spyOn(ProjectAPI, 'list').mockResolvedValue([project]);
    mockMembership();

    const result = await ensureLeadTriageStarter([]);

    expect(ProjectAPI.create).toHaveBeenCalledOnce();
    expect(ProjectAPI.createResource).toHaveBeenCalledOnce();
    expect(ProjectAPI.createDocument).toHaveBeenCalledOnce();
    expect(ProjectAPI.deployDocument).toHaveBeenCalledOnce();
    expect(ProjectAPI.putMember).toHaveBeenCalledWith(
      project.id, ownerMember.principalId, ['OWNER', 'REVIEWER'], ['TECHNICAL'], [], 0);
    expect(result.project?.slug).toBe(STARTER_PROJECT_SLUG);
  });

  it('resumes a partially seeded starter without overwriting its files', async () => {
    const treeWithForm = tree.map((node) => node.name === 'forms'
      ? { ...node, children: [{
          id: 'form-1', kind: 'RESOURCE' as const, name: 'lead-triage-review.json',
          fileName: 'lead-triage-review.json', processKey: null, contentType: 'application/json',
          status: 'ACTIVE', path: '/forms/lead-triage-review.json', revision: 1,
          system: false, children: [],
        }] }
      : node);
    vi.spyOn(ProjectAPI, 'tree').mockResolvedValue(treeWithForm);
    vi.spyOn(ProjectAPI, 'documents')
      .mockResolvedValueOnce([document])
      .mockResolvedValueOnce([{ ...document, lastDeploymentId: 'deployment-1' }]);
    vi.spyOn(ProjectAPI, 'createResource').mockResolvedValue({} as never);
    vi.spyOn(ProjectAPI, 'createDocument').mockResolvedValue(document);
    vi.spyOn(ProjectAPI, 'deployDocument').mockResolvedValue({
      projectId: project.id, processKey: STARTER_PROCESS_KEY, deploymentId: 'deployment-1', version: 1,
    });
    vi.spyOn(ProjectAPI, 'list').mockResolvedValue([project]);
    mockMembership();

    await ensureLeadTriageStarter([project]);

    expect(ProjectAPI.createResource).not.toHaveBeenCalled();
    expect(ProjectAPI.createDocument).not.toHaveBeenCalled();
    expect(ProjectAPI.deployDocument).toHaveBeenCalledOnce();
  });

  it('preserves unrelated projects while creating a separate starter workspace', async () => {
    const existing = { ...project, id: 'existing', slug: 'customer-project' };
    vi.spyOn(ProjectAPI, 'create').mockResolvedValue(project);
    vi.spyOn(ProjectAPI, 'tree').mockResolvedValue(tree);
    vi.spyOn(ProjectAPI, 'documents')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...document, lastDeploymentId: 'deployment-1' }]);
    vi.spyOn(ProjectAPI, 'createResource').mockResolvedValue({} as never);
    vi.spyOn(ProjectAPI, 'createDocument').mockResolvedValue(document);
    vi.spyOn(ProjectAPI, 'deployDocument').mockResolvedValue({
      projectId: project.id, processKey: STARTER_PROCESS_KEY, deploymentId: 'deployment-1', version: 1,
    });
    vi.spyOn(ProjectAPI, 'list').mockResolvedValue([existing, project]);
    mockMembership();

    const result = await ensureLeadTriageStarter([existing]);

    expect(ProjectAPI.create).toHaveBeenCalledWith(
      STARTER_PROJECT_SLUG, expect.any(String), expect.any(String));
    expect(result.projects).toContainEqual(existing);
    expect(result.project?.id).toBe(project.id);
  });
});
