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
}

const headers = (json = true): HeadersInit => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});

const checked = async <T>(response: Response): Promise<T> => {
  if (!response.ok) throw await apiError(response);
  return response.json();
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

  static createDocument(projectId: string, workflow: WorkflowFile,
    description = ''): Promise<ProjectDocument> {
    const aplSource = stringifyAPLYaml(workflowToAPL(workflow));
    return authenticatedFetch(`${this.BASE}/${projectId}/documents`, { method: 'POST', headers: headers(),
      body: JSON.stringify({ processKey: workflow.processKey, description, aplSource }) })
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
      revision: document.revision, updatedAt: document.updatedAt };
  }
}
