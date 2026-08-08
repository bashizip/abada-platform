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
  static async getInstances(): Promise<ProcessInstanceDTO[]> {
    const res = await fetch(`${this.BASE_URL}/processes/instances?size=20`, {
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
  static async startProcess(processId: string, variables: Record<string, any> = {}): Promise<{ processInstanceId: string }> {
    const username = getUserFromToken(keycloak.tokenParsed)?.username || 'studio_user';
    const res = await fetch(`${this.BASE_URL}/processes/start?processId=${encodeURIComponent(processId)}&username=${encodeURIComponent(username)}`, {
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
  static async getInstance(instanceId: string): Promise<ProcessInstanceDTO> {
    const res = await fetch(`${this.BASE_URL}/processes/instances/${encodeURIComponent(instanceId)}`, {
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
  static async findProcessDefinition(processKey: string): Promise<ProcessDefinitionDTO | null> {
    const res = await fetch(`${this.BASE_URL}/processes?key=${encodeURIComponent(processKey)}`, {
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
  static async getTasks(status?: string): Promise<any[]> {
    const url = status && status !== 'all' 
      ? `${this.BASE_URL}/tasks?status=${encodeURIComponent(status)}`
      : `${this.BASE_URL}/tasks`;
    const res = await fetch(url, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.statusText}`);
    return res.json();
  }

  /**
   * Completes a task
   */
  static async completeTask(taskId: string, variables: Record<string, any> = {}): Promise<any> {
    const res = await fetch(`${this.BASE_URL}/tasks/${encodeURIComponent(taskId)}/complete`, {
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
  static async failInstance(instanceId: string): Promise<any> {
    const res = await fetch(`${this.BASE_URL}/processes/instance/${encodeURIComponent(instanceId)}/fail`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fail instance: ${res.statusText}`);
    return res.json();
  }
}
