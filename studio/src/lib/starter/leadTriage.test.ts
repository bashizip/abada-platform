import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectAPI, type Project, type ProjectDocument, type ProjectTreeNode } from '@/api/projects';
import {
  ensureLeadTriageStarter,
  LEAD_TRIAGE_APL,
  STARTER_HUMAN_REVIEW_GROUP,
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
const bobPrincipal = { id: 'principal-2', username: 'bob', type: 'HUMAN' as const };
const bobMember = {
  principalId: bobPrincipal.id, username: 'bob', principalType: 'HUMAN' as const,
  roles: ['VIEWER'] as const, reviewLanes: [], taskGroups: [STARTER_HUMAN_REVIEW_GROUP], version: 0,
};

const mockMembership = () => {
  vi.spyOn(ProjectAPI, 'members').mockResolvedValue([{ ...ownerMember, roles: [...ownerMember.roles] }]);
  vi.spyOn(ProjectAPI, 'principals').mockResolvedValue([bobPrincipal]);
  vi.spyOn(ProjectAPI, 'putMember').mockImplementation(async (_projectId, principalId, roles,
    reviewLanes, taskGroups) => ({
      ...(principalId === ownerMember.principalId ? ownerMember : bobMember),
      principalId, roles, reviewLanes, taskGroups,
    }));
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
    const review = workflow.nodes.find((node) => node.id === 'senior-sales-review')!;
    expect(review.humanConfig?.assignees).toEqual([STARTER_HUMAN_REVIEW_GROUP]);
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
    expect(ProjectAPI.putMember).toHaveBeenNthCalledWith(1,
      project.id, ownerMember.principalId, ['OWNER', 'REVIEWER'], ['TECHNICAL'], [], 0);
    expect(ProjectAPI.putMember).toHaveBeenNthCalledWith(2,
      project.id, bobPrincipal.id, ['VIEWER'], [], [STARTER_HUMAN_REVIEW_GROUP], undefined);
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

  it('opens the deployed starter for Bob without mutating the project', async () => {
    const bobProject: Project = {
      ...project, currentUserRoles: ['VIEWER'], currentUserReviewLanes: [],
    };
    vi.spyOn(ProjectAPI, 'documents').mockResolvedValue([{ ...document, lastDeploymentId: 'deployment-1' }]);
    vi.spyOn(ProjectAPI, 'list').mockResolvedValue([bobProject]);
    const create = vi.spyOn(ProjectAPI, 'create');
    const members = vi.spyOn(ProjectAPI, 'members');
    const treeCall = vi.spyOn(ProjectAPI, 'tree');
    const putMember = vi.spyOn(ProjectAPI, 'putMember');

    const result = await ensureLeadTriageStarter([bobProject]);

    expect(result.document?.lastDeploymentId).toBe('deployment-1');
    expect(create).not.toHaveBeenCalled();
    expect(members).not.toHaveBeenCalled();
    expect(treeCall).not.toHaveBeenCalled();
    expect(putMember).not.toHaveBeenCalled();
  });

  it('tells Bob to let Alice initialize when no starter is visible', async () => {
    vi.spyOn(ProjectAPI, 'create').mockRejectedValue(new Error('Forbidden'));

    await expect(ensureLeadTriageStarter([])).rejects.toThrow(
      'Sign in once as alice / alice, then retry as bob');
  });

  it('preserves existing Bob roles and task groups while adding the dedicated review group', async () => {
    const readyOwnerProject: Project = {
      ...project, currentUserRoles: ['OWNER', 'REVIEWER'], currentUserReviewLanes: ['TECHNICAL'],
    };
    const existingBob = {
      ...bobMember, roles: ['VIEWER', 'OPERATOR'] as const, taskGroups: ['customer-support'], version: 4,
    };
    vi.spyOn(ProjectAPI, 'members').mockResolvedValue([
      { ...ownerMember, roles: ['OWNER', 'REVIEWER'], reviewLanes: ['TECHNICAL'] },
      { ...existingBob, roles: [...existingBob.roles] },
    ]);
    const putMember = vi.spyOn(ProjectAPI, 'putMember').mockResolvedValue({
      ...existingBob, roles: [...existingBob.roles],
      taskGroups: ['customer-support', STARTER_HUMAN_REVIEW_GROUP],
    });
    vi.spyOn(ProjectAPI, 'tree').mockResolvedValue(tree);
    vi.spyOn(ProjectAPI, 'documents').mockResolvedValue([{ ...document, lastDeploymentId: 'deployment-1' }]);
    vi.spyOn(ProjectAPI, 'createResource').mockResolvedValue({} as never);
    vi.spyOn(ProjectAPI, 'list').mockResolvedValue([readyOwnerProject]);

    await ensureLeadTriageStarter([readyOwnerProject]);

    expect(putMember).toHaveBeenCalledWith(project.id, bobPrincipal.id,
      ['VIEWER', 'OPERATOR'], [], ['customer-support', STARTER_HUMAN_REVIEW_GROUP], 4);
  });

  it('does not rewrite a correctly provisioned Bob membership', async () => {
    const readyOwnerProject: Project = {
      ...project, currentUserRoles: ['OWNER', 'REVIEWER'], currentUserReviewLanes: ['TECHNICAL'],
    };
    vi.spyOn(ProjectAPI, 'members').mockResolvedValue([
      { ...ownerMember, roles: ['OWNER', 'REVIEWER'], reviewLanes: ['TECHNICAL'] },
      { ...bobMember, roles: [...bobMember.roles], taskGroups: [...bobMember.taskGroups] },
    ]);
    const putMember = vi.spyOn(ProjectAPI, 'putMember');
    vi.spyOn(ProjectAPI, 'tree').mockResolvedValue(tree);
    vi.spyOn(ProjectAPI, 'documents').mockResolvedValue([{ ...document, lastDeploymentId: 'deployment-1' }]);
    vi.spyOn(ProjectAPI, 'createResource').mockResolvedValue({} as never);
    vi.spyOn(ProjectAPI, 'list').mockResolvedValue([readyOwnerProject]);

    await ensureLeadTriageStarter([readyOwnerProject]);

    expect(putMember).not.toHaveBeenCalled();
  });
});
