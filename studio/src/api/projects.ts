import { config } from '@/config/runtime';
import { apiError, authenticatedFetch } from '@/api/authenticatedFetch';
import { aplToWorkflow, parseAPLYaml, stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import { WorkflowFile } from '@/types';
import type { DeploymentResult, ProcessDefinitionDTO } from '@/api/engine';

export type ProjectRole = 'OWNER' | 'MAINTAINER' | 'OPERATOR' | 'REVIEWER' | 'VIEWER';

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: 'ACTIVE' | 'ARCHIVED';
  version: number;
  processCount: number;
  currentUserRoles: ProjectRole[];
  currentUserReviewLanes: string[];
}

export interface ProjectMember {
  principalId: string;
  username: string;
  principalType: 'HUMAN' | 'SERVICE';
  roles: ProjectRole[];
  reviewLanes: string[];
  version: number;
}

export interface Principal { id: string; username: string; type: 'HUMAN' | 'SERVICE' }

export interface ProjectDocument {
  id: string;
  projectId: string;
  processKey: string;
  name: string;
  description: string;
  aplSource: string;
  status: 'ACTIVE' | 'ARCHIVED';
  revision: number;
  updatedAt: string;
  lastDeploymentId?: string;
  folderId?: string | null;
  fileName?: string | null;
}

export type ResourceKind = 'FORM' | 'RESOURCE';

export interface ProjectFolder {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  path: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectResource {
  id: string;
  projectId: string;
  folderId: string | null;
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  kind: ResourceKind;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectResourceContent extends ProjectResource {
  contentBase64: string;
}

export type ProjectTreeNodeKind = 'FOLDER' | 'DOCUMENT' | 'RESOURCE';

export interface ProjectTreeNode {
  id: string;
  kind: ProjectTreeNodeKind;
  name: string;
  fileName: string | null;
  processKey: string | null;
  contentType: string | null;
  status: string | null;
  path: string;
  revision: number;
  children: ProjectTreeNode[];
}

/** Flattens a tree into folder entries with their breadcrumb paths. */
export const flattenTreeFolders = (nodes: ProjectTreeNode[],
  path: string[] = [], out: { folder: ProjectTreeNode; path: string }[] = []): { folder: ProjectTreeNode; path: string }[] => {
  for (const node of nodes) {
    if (node.kind !== 'FOLDER') continue;
    out.push({ folder: node, path: [...path, node.name].join('/') });
    flattenTreeFolders(node.children, [...path, node.name], out);
  }
  return out;
};

const headers = (json = true): HeadersInit => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});

const checked = async <T>(response: Response): Promise<T> => {
  if (!response.ok) throw await apiError(response);
  return response.json();
};

const checkedVoid = async (response: Response): Promise<void> => {
  if (!response.ok) throw await apiError(response);
};

export class ProjectAPI {
  private static readonly BASE = `${config.apiUrl}/v1/projects`;

  static list(): Promise<Project[]> {
    return authenticatedFetch(this.BASE, { headers: headers() }).then(checked<Project[]>);
  }

  static create(slug: string, name: string, description: string): Promise<Project> {
    return authenticatedFetch(this.BASE, { method: 'POST', headers: headers(),
      body: JSON.stringify({ slug, name, description }) }).then(checked<Project>);
  }

  static documents(projectId: string): Promise<ProjectDocument[]> {
    return authenticatedFetch(`${this.BASE}/${projectId}/documents?size=100`, { headers: headers() })
      .then(checked<ProjectDocument[]>);
  }

  static tree(projectId: string): Promise<ProjectTreeNode[]> {
    return authenticatedFetch(`${this.BASE}/${projectId}/tree`, { headers: headers() })
      .then(checked<ProjectTreeNode[]>);
  }

  static createFolder(projectId: string, name: string, parentId: string | null = null): Promise<ProjectFolder> {
    return authenticatedFetch(`${this.BASE}/${projectId}/folders`, { method: 'POST', headers: headers(),
      body: JSON.stringify({ name, parentId: parentId ?? '' }) })
      .then(checked<ProjectFolder>);
  }

  static renameFolder(projectId: string, folderId: string, name: string): Promise<ProjectFolder> {
    return authenticatedFetch(`${this.BASE}/${projectId}/folders/${folderId}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify({ expectedRevision: -1, name }) })
      .then(checked<ProjectFolder>);
  }

  static moveFolder(projectId: string, folderId: string, parentId: string | null,
    revision: number): Promise<ProjectFolder> {
    return authenticatedFetch(`${this.BASE}/${projectId}/folders/${folderId}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify({ expectedRevision: revision,
        parentId: parentId ?? '' }) })
      .then(checked<ProjectFolder>);
  }

  static deleteFolder(projectId: string, folderId: string): Promise<void> {
    return authenticatedFetch(`${this.BASE}/${projectId}/folders/${folderId}`, { method: 'DELETE' })
      .then(checkedVoid);
  }

  static createResource(projectId: string, name: string, kind: ResourceKind,
    contentType: string, contentBase64: string,
    folderId: string | null = null): Promise<ProjectResource> {
    return authenticatedFetch(`${this.BASE}/${projectId}/resources`, { method: 'POST', headers: headers(),
      body: JSON.stringify({ name, kind, contentType, contentBase64, folderId: folderId ?? '' }) })
      .then(checked<ProjectResource>);
  }

  static getResource(projectId: string, resourceId: string): Promise<ProjectResourceContent> {
    return authenticatedFetch(`${this.BASE}/${projectId}/resources/${resourceId}`, { headers: headers() })
      .then(checked<ProjectResourceContent>);
  }

  static replaceResource(projectId: string, resourceId: string, contentType: string,
    contentBase64: string, expectedRevision: number): Promise<ProjectResource> {
    return authenticatedFetch(`${this.BASE}/${projectId}/resources/${resourceId}`, {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ contentType, contentBase64, expectedRevision }) })
      .then(checked<ProjectResource>);
  }

  static renameResource(projectId: string, resourceId: string, name: string,
    expectedRevision: number): Promise<ProjectResource> {
    return authenticatedFetch(`${this.BASE}/${projectId}/resources/${resourceId}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify({ expectedRevision, name }) })
      .then(checked<ProjectResource>);
  }

  static moveResource(projectId: string, resourceId: string, folderId: string | null,
    expectedRevision: number): Promise<ProjectResource> {
    return authenticatedFetch(`${this.BASE}/${projectId}/resources/${resourceId}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ expectedRevision, folderId: folderId ?? '' }) })
      .then(checked<ProjectResource>);
  }

  static deleteResource(projectId: string, resourceId: string): Promise<void> {
    return authenticatedFetch(`${this.BASE}/${projectId}/resources/${resourceId}`, { method: 'DELETE' })
      .then(checkedVoid);
  }

  static createDocument(projectId: string, workflow: WorkflowFile,
    description = '', location?: { folderId?: string | null; fileName?: string | null }): Promise<ProjectDocument> {
    const aplSource = stringifyAPLYaml(workflowToAPL(workflow));
    return authenticatedFetch(`${this.BASE}/${projectId}/documents`, { method: 'POST', headers: headers(),
      body: JSON.stringify({ processKey: workflow.processKey, description, aplSource,
        folderId: location?.folderId ?? null, fileName: location?.fileName ?? null }) })
      .then(checked<ProjectDocument>);
  }

  static saveDocument(projectId: string, workflow: WorkflowFile): Promise<ProjectDocument> {
    if (!workflow.documentId || workflow.revision === undefined) {
      throw new Error('The process document has not been created in this project');
    }
    return authenticatedFetch(`${this.BASE}/${projectId}/documents/${workflow.documentId}`, {
      method: 'PUT', headers: { ...headers(), 'If-Match': String(workflow.revision) },
      body: JSON.stringify({ description: workflow.description || '',
        aplSource: stringifyAPLYaml(workflowToAPL(workflow)) }),
    }).then(checked<ProjectDocument>);
  }

  static async deployDocument(projectId: string, workflow: WorkflowFile): Promise<DeploymentResult> {
    if (!workflow.documentId || workflow.revision === undefined) {
      throw new Error('Save the process in the project before deploying');
    }
    const deployed = await authenticatedFetch(`${this.BASE}/${projectId}/documents/${workflow.documentId}/deploy`, {
      method: 'POST', headers: { ...headers(), 'If-Match': String(workflow.revision) },
    }).then(checked<ProcessDefinitionDTO>);
    return {
      projectId: deployed.projectId,
      processKey: deployed.id,
      deploymentId: deployed.deploymentId,
      version: deployed.version,
      schemaType: deployed.schemaType,
    };
  }

  static async renameDocument(projectId: string, documentId: string, fileName: string,
    expectedRevision: number): Promise<ProjectDocument> {
    return authenticatedFetch(`${this.BASE}/${projectId}/documents/${documentId}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify({ expectedRevision, fileName }) })
      .then(checked<ProjectDocument>);
  }

  static async moveDocument(projectId: string, documentId: string, folderId: string | null,
    expectedRevision: number): Promise<ProjectDocument> {
    return authenticatedFetch(`${this.BASE}/${projectId}/documents/${documentId}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify({ expectedRevision,
        folderId: folderId ?? '' }) })
      .then(checked<ProjectDocument>);
  }

  static async archiveDocument(projectId: string, documentId: string, archived: boolean,
    expectedRevision: number): Promise<ProjectDocument> {
    return authenticatedFetch(`${this.BASE}/${projectId}/documents/${documentId}/archive`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ expectedRevision, archived }) })
      .then(checked<ProjectDocument>);
  }

  static members(projectId: string): Promise<ProjectMember[]> {
    return authenticatedFetch(`${this.BASE}/${projectId}/members`, { headers: headers() })
      .then(checked<ProjectMember[]>);
  }

  static principals(projectId: string, query = ''): Promise<Principal[]> {
    return authenticatedFetch(`${this.BASE}/${projectId}/principals?query=${encodeURIComponent(query)}`,
      { headers: headers() }).then(checked<Principal[]>);
  }

  static putMember(projectId: string, principalId: string, roles: ProjectRole[],
    reviewLanes: string[], expectedVersion?: number): Promise<ProjectMember> {
    return authenticatedFetch(`${this.BASE}/${projectId}/members/${principalId}`, { method: 'PUT', headers: headers(),
      body: JSON.stringify({ expectedVersion: expectedVersion ?? null, roles, reviewLanes }) })
      .then(checked<ProjectMember>);
  }

  static workflow(document: ProjectDocument): WorkflowFile {
    const workflow = aplToWorkflow(parseAPLYaml(document.aplSource));
    return { ...workflow, id: document.id, documentId: document.id,
      processKey: document.processKey, description: document.description,
      revision: document.revision, updatedAt: document.updatedAt,
      folderId: document.folderId ?? undefined, fileName: document.fileName ?? undefined };
  }
}
