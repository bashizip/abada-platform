import { stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import { WorkflowFile } from '@/types';

export interface DeploymentResponse {
  status: string;
  processDefinitionId: string;
  deploymentId: string;
  version: number;
  definitionFormatVersion?: string;
  schemaType?: 'APL_NATIVE' | 'BPMN_XML';
  compatibilityProfiles?: string[];
  compatibilityReport?: Record<string, unknown>;
}

export interface ProcessInstanceDTO {
  projectId?: string;
  id: string;
  processDefinitionId: string;
  startDate: string;
  endDate?: string;
  status: string;
  variables: Record<string, any>;
}

import { config } from '@/config/runtime';
import { keycloak } from '@/auth/keycloakClient';
import { getUserFromToken } from '@/auth/keycloakClient';

export interface ProcessDefinitionDTO {
  projectId?: string;
  id: string;
  name: string;
  version: number;
  schemaType: 'APL_NATIVE' | 'BPMN_XML';
}

export class EngineAPI {
  private static readonly BASE_URL = `${config.apiUrl}/v1`;

  private static getHeaders(isFormData = false): HeadersInit {
    const headers: HeadersInit = {};
    if (keycloak.token) {
      headers['Authorization'] = `Bearer ${keycloak.token}`;
    }
    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }

  /**
   * Deploys a WorkflowFile to the Abada Engine.
   * Deploys the canonical abada.io/v1 APL YAML directly. Studio never uses an
   * XML round-trip for authored or imported-and-converted workflows.
   */
  static async deployWorkflow(workflow: WorkflowFile): Promise<DeploymentResponse> {
    const apl = workflowToAPL(workflow);
    const aplYaml = stringifyAPLYaml(apl);

    const formData = new FormData();
    const blob = new Blob([aplYaml], { type: 'application/yaml' });
    formData.append('file', blob, `${workflow.name || 'process'}.apl.yaml`);
    formData.append('strict', 'true');

    const res = await fetch(`${this.BASE_URL}/processes/deploy`, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Deployment failed: ${res.statusText} - ${text}`);
    }

    return res.json();
  }

  /**
   * Gets a list of recent process instances
   */
  static async getInstances(projectId?: string): Promise<ProcessInstanceDTO[]> {
    const path = projectId ? `/projects/${projectId}/instances?size=20` : '/processes/instances?size=20';
    const res = await fetch(`${this.BASE_URL}${path}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch instances: ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Starts a new process instance using the authenticated user's identity.
   */
  static async startProcess(processId: string, variables: Record<string, any> = {}, projectId?: string): Promise<{ processInstanceId: string }> {
    const username = getUserFromToken(keycloak.tokenParsed)?.username || 'studio_user';
    const path = projectId
      ? `/projects/${projectId}/processes/${encodeURIComponent(processId)}/start`
      : `/processes/start?processId=${encodeURIComponent(processId)}&username=${encodeURIComponent(username)}`;
    const res = await fetch(`${this.BASE_URL}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(variables)
    });
    if (!res.ok) {
      throw new Error(`Failed to start process: ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Retrieves a single process instance with its live status and variables.
   */
  static async getInstance(instanceId: string, projectId?: string): Promise<ProcessInstanceDTO> {
    const path = projectId
      ? `/projects/${projectId}/instances/${encodeURIComponent(instanceId)}`
      : `/processes/instances/${encodeURIComponent(instanceId)}`;
    const res = await fetch(`${this.BASE_URL}${path}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch instance: ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Finds an already-deployed process definition by its process key, or null.
   */
  static async findProcessDefinition(processKey: string, projectId?: string): Promise<ProcessDefinitionDTO | null> {
    const path = projectId ? `/projects/${projectId}/processes?key=${encodeURIComponent(processKey)}`
      : `/processes?key=${encodeURIComponent(processKey)}`;
    const res = await fetch(`${this.BASE_URL}${path}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch process definitions: ${res.statusText}`);
    }
    const definitions: ProcessDefinitionDTO[] = await res.json();
    return definitions.find((d) => d.id === processKey) || null;
  }

  /**
   * Retrieves tasks, optionally filtered by status
   */
  static async getTasks(status?: string, projectId?: string): Promise<any[]> {
    const base = projectId ? `${this.BASE_URL}/projects/${projectId}/tasks` : `${this.BASE_URL}/tasks`;
    const url = status && status !== 'all' ? `${base}?status=${encodeURIComponent(status)}` : base;
    const res = await fetch(url, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.statusText}`);
    return res.json();
  }

  /**
   * Completes a task
   */
  static async completeTask(taskId: string, variables: Record<string, any> = {}, projectId?: string): Promise<any> {
    const path = projectId ? `/projects/${projectId}/tasks/${encodeURIComponent(taskId)}/complete`
      : `/tasks/complete?taskId=${encodeURIComponent(taskId)}`;
    const res = await fetch(`${this.BASE_URL}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(variables)
    });
    if (!res.ok) throw new Error(`Failed to complete task: ${res.statusText}`);
    return res.json();
  }

  /**
   * Fails a process instance
   */
  static async failInstance(instanceId: string, projectId?: string): Promise<any> {
    const path = projectId ? `/projects/${projectId}/instances/${encodeURIComponent(instanceId)}/fail`
      : `/processes/instance/${encodeURIComponent(instanceId)}/fail`;
    const res = await fetch(`${this.BASE_URL}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fail instance: ${res.statusText}`);
    return res.json();
  }
}
