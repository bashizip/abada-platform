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

export interface DeploymentResult {
  projectId?: string;
  processKey: string;
  deploymentId: string;
  version: number;
  schemaType?: 'APL_NATIVE' | 'BPMN_XML';
}

export interface InstanceQuery {
  /** Optional ProcessStatus filter: RUNNING | COMPLETED | FAILED | SUSPENDED | CANCELLED. */
  status?: string;
  /** Optional process definition key filter. */
  processDefinitionId?: string;
  page?: number;
  size?: number;
}

export interface ProjectJob {
  id: string;
  processInstanceId: string;
  activityId: string;
  exceptionMessage?: string | null;
  retries?: number | null;
}

export interface InstancePage {
  items: ProcessInstanceDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProcessInstanceDTO {
  projectId?: string;
  id: string;
  processDefinitionId: string;
  processDefinitionDeploymentId?: string;
  processDefinitionName?: string;
  currentActivityId?: string;
  startDate: string;
  endDate?: string;
  status: string;
  suspended?: boolean;
  startedBy?: string;
  variables: Record<string, unknown>;
}

export interface EngineUserTaskDTO {
  id: string;
  name?: string;
  assignee?: string;
  created?: string;
  createTime?: string;
  dueDate?: string;
  processInstanceId?: string;
  processDefinitionId?: string;
  taskDefinitionKey?: string;
  status?: string;
  variables?: Record<string, unknown>;
}

export interface TaskOperationResultDTO {
  taskId: string;
  status: string;
  variables?: Record<string, unknown>;
}

export interface InstanceOperationResultDTO {
  instanceId: string;
  status: string;
}

export interface ActivityInstanceDTO {
  activityId: string;
  activityName: string;
  executionId: string;
}

export interface ActivityHistoryDTO {
  id: string;
  processInstanceId: string;
  processDefinitionId: string;
  activityId?: string;
  eventType: string;
  actor: string;
  occurredAt: string;
  traceId?: string;
  details: Record<string, unknown>;
}

import { config } from '@/config/runtime';
import { keycloak } from '@/auth/keycloakClient';
import { getUserFromToken } from '@/auth/keycloakClient';
import { authenticatedFetch } from '@/api/authenticatedFetch';

export interface ProcessDefinitionDTO {
  projectId?: string;
  id: string;
  name: string;
  documentation?: string;
  bpmnXml?: string;
  deploymentId: string;
  version: number;
  schemaType: 'APL_NATIVE' | 'BPMN_XML';
  createdAt?: string;
}

/** Liveness and incident record for one external worker topic in a project. */
export interface WorkerHealthDTO {
  projectId: string;
  principalId: string;
  principalUsername: string;
  topic: string;
  bound: boolean;
  status: 'ONLINE' | 'ERROR' | 'OFFLINE';
  lastSeenAt?: string | null;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorMessage?: string | null;
  consecutiveFailures: number;
  lastWorkerId?: string | null;
}

export class EngineAPI {
  private static readonly BASE_URL = `${config.apiUrl}/v1`;

  private static getHeaders(isFormData = false): HeadersInit {
    const headers: HeadersInit = {};
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
  static async deployWorkflow(workflow: WorkflowFile): Promise<DeploymentResult> {
    const apl = workflowToAPL(workflow);
    const aplYaml = stringifyAPLYaml(apl);

    const formData = new FormData();
    const blob = new Blob([aplYaml], { type: 'application/yaml' });
    formData.append('file', blob, `${workflow.name || 'process'}.apl.yaml`);
    formData.append('strict', 'true');

    const res = await authenticatedFetch(`${this.BASE_URL}/processes/deploy`, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Deployment failed: ${res.statusText} - ${text}`);
    }

    const deployed = await res.json() as DeploymentResponse;
    return {
      processKey: deployed.processDefinitionId,
      deploymentId: deployed.deploymentId,
      version: deployed.version,
      schemaType: deployed.schemaType,
    };
  }

  /**
   * Gets a page of process instances, optionally filtered by status and/or
   * process definition. Reads the engine pagination headers so consumers get
   * accurate totals for KPIs and infinite scroll.
   */
  static async getInstances(projectId?: string, query: InstanceQuery = {}): Promise<InstancePage> {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.processDefinitionId) params.set('processDefinitionId', query.processDefinitionId);
    params.set('page', String(query.page ?? 0));
    params.set('size', String(query.size ?? 50));
    const path = projectId
      ? `/projects/${projectId}/instances?${params}`
      : `/processes/instances?${params}`;
    const res = await authenticatedFetch(`${this.BASE_URL}${path}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch instances: ${res.statusText}`);
    }
    const items = await res.json() as ProcessInstanceDTO[];
    const header = (name: string): number => {
      const value = res.headers.get(name);
      return value === null || Number.isNaN(Number(value)) ? 0 : Number(value);
    };
    return {
      items,
      page: header('X-Page'),
      pageSize: header('X-Page-Size') || items.length,
      total: header('X-Total-Count'),
      totalPages: header('X-Total-Pages'),
    };
  }

  /** Lists every deployed process definition (one row per version) in a project. */
  static async getProcessDefinitions(projectId: string): Promise<ProcessDefinitionDTO[]> {
    const res = await authenticatedFetch(
      `${this.BASE_URL}/projects/${projectId}/processes?size=100`,
      { headers: this.getHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to fetch process definitions: ${res.statusText}`);
    return res.json();
  }

  /** Reads the typed variable map of a process instance. */
  static async getInstanceVariables(instanceId: string, projectId: string): Promise<Record<string, unknown>> {
    const res = await authenticatedFetch(
      `${this.BASE_URL}/projects/${projectId}/instances/${encodeURIComponent(instanceId)}/variables`,
      { headers: this.getHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to fetch instance variables: ${res.statusText}`);
    return res.json();
  }

  /** Cancels a process instance (terminal state) with an audit reason. */
  static async cancelInstance(instanceId: string, projectId: string, reason = 'Cancelled from Studio'): Promise<void> {
    const res = await authenticatedFetch(
      `${this.BASE_URL}/projects/${projectId}/instances/${encodeURIComponent(instanceId)}`,
      { method: 'DELETE', headers: this.getHeaders(), body: JSON.stringify({ reason }) },
    );
    if (!res.ok) throw new Error(`Failed to cancel instance: ${res.statusText}`);
  }

  /**
   * Lists external-task jobs (incidents) in a project — failed or in-flight
   * durable jobs with retry counters and error messages.
   */
  static async getJobs(projectId: string, active = true): Promise<ProjectJob[]> {
    const res = await authenticatedFetch(
      `${this.BASE_URL}/projects/${projectId}/jobs?active=${active}&size=100`,
      { headers: this.getHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to fetch jobs: ${res.statusText}`);
    return res.json();
  }

  /** Sets the retry counter for a failed job, returning it to the OPEN queue. */
  static async retryJob(projectId: string, jobId: string, retries: number): Promise<void> {
    const res = await authenticatedFetch(
      `${this.BASE_URL}/projects/${projectId}/jobs/${encodeURIComponent(jobId)}/retries`,
      { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ retries }) },
    );
    if (!res.ok) throw new Error(`Failed to retry job: ${res.statusText}`);
  }

  /**
   * Lists the liveness and incident state of every bound (or attempted)
   * external worker/topic in a project — heartbeat, status and the recent
   * rejection errors that otherwise only appear in worker container logs.
   */
  static async getWorkerHealth(projectId: string): Promise<WorkerHealthDTO[]> {
    const res = await authenticatedFetch(
      `${this.BASE_URL}/projects/${projectId}/workers/health`,
      { headers: this.getHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to fetch worker health: ${res.statusText}`);
    return res.json();
  }

  /** Suspends or resumes a process instance. */
  static async setInstanceSuspension(instanceId: string, projectId: string, suspended: boolean): Promise<void> {
    const res = await authenticatedFetch(
      `${this.BASE_URL}/projects/${projectId}/instances/${encodeURIComponent(instanceId)}/suspension`,
      { method: 'PUT', headers: this.getHeaders(), body: JSON.stringify({ suspended }) },
    );
    if (!res.ok) throw new Error(`Failed to update instance suspension: ${res.statusText}`);
  }

  /**
   * Starts a new process instance using the authenticated user's identity.
   */
  static async startProcess(processId: string, variables: Record<string, unknown> = {}, projectId?: string): Promise<{ processInstanceId: string }> {
    const username = getUserFromToken(keycloak.tokenParsed)?.username || 'studio_user';
    const path = projectId
      ? `/projects/${projectId}/processes/${encodeURIComponent(processId)}/start`
      : `/processes/start?processId=${encodeURIComponent(processId)}&username=${encodeURIComponent(username)}`;
    const res = await authenticatedFetch(`${this.BASE_URL}${path}`, {
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
    const res = await authenticatedFetch(`${this.BASE_URL}${path}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch instance: ${res.statusText}`);
    }
    return res.json();
  }

  static async getActivityInstances(instanceId: string, projectId: string): Promise<ActivityInstanceDTO[]> {
    const res = await authenticatedFetch(
      `${this.BASE_URL}/projects/${projectId}/instances/${encodeURIComponent(instanceId)}/activity-instances`,
      { headers: this.getHeaders() }
    );
    if (!res.ok) throw new Error(`Failed to fetch active activities: ${res.statusText}`);
    const tree = await res.json() as { childActivityInstances?: ActivityInstanceDTO[] };
    return tree.childActivityInstances || [];
  }

  static async getInstanceHistory(instanceId: string, projectId: string): Promise<ActivityHistoryDTO[]> {
    const res = await authenticatedFetch(
      `${this.BASE_URL}/projects/${projectId}/instances/${encodeURIComponent(instanceId)}/history?size=100`,
      { headers: this.getHeaders() }
    );
    if (!res.ok) throw new Error(`Failed to fetch instance history: ${res.statusText}`);
    return res.json();
  }

  static async getDefinitionForInstance(
    instance: ProcessInstanceDTO,
    projectId: string
  ): Promise<ProcessDefinitionDTO | null> {
    const res = await authenticatedFetch(
      `${this.BASE_URL}/projects/${projectId}/processes?key=${encodeURIComponent(instance.processDefinitionId)}&size=100`,
      { headers: this.getHeaders() }
    );
    if (!res.ok) throw new Error(`Failed to fetch process definition: ${res.statusText}`);
    const definitions = await res.json() as ProcessDefinitionDTO[];
    if (instance.processDefinitionDeploymentId) {
      return definitions.find((definition) =>
        definition.deploymentId === instance.processDefinitionDeploymentId) || null;
    }
    return definitions[0] || null;
  }

  /**
   * Finds an already-deployed process definition by its process key, or null.
   */
  static async findProcessDefinition(processKey: string, projectId?: string): Promise<ProcessDefinitionDTO | null> {
    const path = projectId ? `/projects/${projectId}/processes?key=${encodeURIComponent(processKey)}`
      : `/processes?key=${encodeURIComponent(processKey)}`;
    const res = await authenticatedFetch(`${this.BASE_URL}${path}`, {
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
  static async getTasks(status?: string, projectId?: string): Promise<EngineUserTaskDTO[]> {
    const base = projectId ? `${this.BASE_URL}/projects/${projectId}/tasks` : `${this.BASE_URL}/tasks`;
    const url = status && status !== 'all' ? `${base}?status=${encodeURIComponent(status)}` : base;
    const res = await authenticatedFetch(url, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.statusText}`);
    return res.json();
  }

  /**
   * Completes a task
   */
  static async completeTask(taskId: string, variables: Record<string, unknown> = {}, projectId?: string): Promise<TaskOperationResultDTO> {
    const path = projectId ? `/projects/${projectId}/tasks/${encodeURIComponent(taskId)}/complete`
      : `/tasks/complete?taskId=${encodeURIComponent(taskId)}`;
    const res = await authenticatedFetch(`${this.BASE_URL}${path}`, {
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
  static async failInstance(instanceId: string, projectId?: string): Promise<InstanceOperationResultDTO> {
    const path = projectId ? `/projects/${projectId}/instances/${encodeURIComponent(instanceId)}/fail`
      : `/processes/instance/${encodeURIComponent(instanceId)}/fail`;
    const res = await authenticatedFetch(`${this.BASE_URL}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fail instance: ${res.statusText}`);
    return res.json();
  }
}
