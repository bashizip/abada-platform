import { refreshToken, keycloak } from "@/auth/keycloakClient";
import { runtimeConfig } from "@/config/runtime";

const API_BASE_URL = runtimeConfig.apiUrl;

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError | string;
  status: number;
  pagination?: PaginationMetadata;
}

export interface ApiError {
  timestamp: string;
  status: number;
  code: string;
  message: string;
  path: string;
  traceId?: string;
  details?: Record<string, unknown>;
}

export interface PaginationMetadata {
  page: number;
  size: number;
  totalCount: number;
  totalPages: number;
}

export type TaskStatus = "AVAILABLE" | "CLAIMED" | "COMPLETED" | "FAILED";

export type ProcessStatus = "RUNNING" | "COMPLETED" | "SUSPENDED" | "FAILED";

export interface TaskDetailsDto {
  id: string;
  taskDefinitionKey: string;
  name: string;
  assignee?: string;
  status: TaskStatus;
  startDate?: string;
  endDate?: string;
  candidateUsers?: string[];
candidateGroups?: string[];
formKey?: string;
    processInstanceId: string;
    projectId?: string;
    processDefinitionId: string;
  processDefinitionName: string;
  processStatus: ProcessStatus;
  processSuspended: boolean;
  processStartDate?: string;
  processEndDate?: string;
  currentActivityId?: string;
  variables?: Record<string, unknown>;
}

export interface ProcessInstanceDTO {
  id: string;
  processDefinitionId: string;
  processDefinitionName: string;
  currentActivityId?: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "SUSPENDED" | "CANCELLED";
  suspended: boolean;
  startDate: string;
  endDate?: string;
  startedBy: string;
  variables: Record<string, unknown>;
}

export interface ProcessDefinition {
  id: string;
  name: string;
  documentation?: string;
  bpmnXml?: string;
  deploymentId: string;
  version: number;
  createdAt: string;
}

export interface ProcessInstanceDetailsDto {
  id: string;
  processDefinitionId: string;
  processDefinitionName: string;
  currentActivityId?: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "SUSPENDED" | "CANCELLED";
  suspended: boolean;
  startDate: string;
  endDate?: string;
  startedBy: string;
  variables: Record<string, unknown>;
}

export interface ActivityInstanceDto {
  id: string;
  activityId?: string;
  activityName?: string;
  activityType?: string;
  startTime?: string;
  endTime?: string;
}

export interface UserStatsDto {
  quickStats: {
    activeTasks: number;
    completedTasks: number;
    runningProcesses: number;
    availableTasks: number;
  };
  recentTasks: Array<{
    id: string;
    name: string;
    taskDefinitionKey: string;
    status: TaskStatus;
    startDate: string;
    processInstanceId: string;
    processDefinitionId: string;
    processDefinitionName: string;
    assignee?: string;
  }>;
  tasksByStatus: {
    AVAILABLE: number;
    CLAIMED: number;
    COMPLETED: number;
    FAILED: number;
  };
  overdueTasks: Array<{
    id: string;
    name: string;
    taskDefinitionKey: string;
    startDate: string;
    daysOverdue: number;
    processInstanceId: string;
  }>;
  processActivity: {
    recentlyStartedProcesses: Array<{
      id: string;
      processDefinitionId: string;
      processDefinitionName?: string;
      startDate: string;
      currentActivityId: string | null;
    }>;
    activeProcessCount: number;
    completionRate: number;
  };
}

class ApiClient {
  private toHeaderRecord(headers?: HeadersInit): Record<string, string> {
    if (!headers) return {};
    const normalized: Record<string, string> = {};
    new Headers(headers).forEach((value, key) => {
      normalized[key] = value;
    });
    return normalized;
  }

  private async getAuthHeaders(): Promise<HeadersInit> {
    await refreshToken(30);
    const headers: Record<string, string> = {};

    if (keycloak.token) {
      headers["Authorization"] = `Bearer ${keycloak.token}`;
    }

    return headers;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<ApiResponse<T>> {
    try {
      const isFormData = options.body instanceof FormData;
      const authHeaders = await this.getAuthHeaders();
      const providedHeaders = this.toHeaderRecord(options.headers);

      const requestHeaders: Record<string, string> = {
        ...this.toHeaderRecord(authHeaders),
        ...providedHeaders,
      };

      if (!isFormData) {
        requestHeaders["Content-Type"] = "application/json";
      }

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: requestHeaders,
      });

      if (response.ok) {
        const totalCount = response.headers.get("X-Total-Count");
        const pagination = totalCount
          ? {
              page: Number(response.headers.get("X-Page")),
              size: Number(response.headers.get("X-Page-Size")),
              totalCount: Number(totalCount),
              totalPages: Number(response.headers.get("X-Total-Pages")),
            }
          : undefined;
        if (
          response.status === 204 ||
          response.headers.get("Content-Length") === "0"
        ) {
          return { data: undefined, status: response.status, pagination };
        }
        const data = await response.json();
        return { data, status: response.status, pagination };
      }

      let errorPayload: unknown = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorPayload = errorData as ApiError;
        if (response.status === 400) {
          console.error("API Error (400):", errorData);
        }
      } catch (e) {
        // Not a JSON error response
      }
      return { status: response.status, error: errorPayload };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Network error";
      console.error("Network Error:", errorMessage);
      return {
        status: 0,
        error: errorMessage,
      };
    }
  }

  // Task endpoints
  async getTasks(filters?: {
    status?: string;
    page?: number;
    size?: number;
  }): Promise<ApiResponse<TaskDetailsDto[]>> {
    const queryParams = new URLSearchParams();
    if (filters?.status) queryParams.append("status", filters.status);
    if (filters?.page !== undefined)
      queryParams.append("page", String(filters.page));
    if (filters?.size !== undefined)
      queryParams.append("size", String(filters.size));
    const queryString = queryParams.toString();

    return this.request(`/v1/tasks${queryString ? `?${queryString}` : ""}`);
  }

  async getTask(id: string): Promise<ApiResponse<TaskDetailsDto>> {
    return this.request(`/v1/tasks/${id}`);
  }

  async claimTask(
    taskId: string,
  ): Promise<ApiResponse<{ status: string; taskId: string }>> {
    return this.request(
      `/v1/tasks/claim?taskId=${encodeURIComponent(taskId)}`,
      { method: "POST" },
    );
  }

  async completeTask(
    taskId: string,
    variables?: Record<string, unknown>,
  ): Promise<ApiResponse<{ status: string; taskId: string }>> {
    const endpoint = `/v1/tasks/complete?taskId=${encodeURIComponent(taskId)}`;
    return this.request(endpoint, {
      method: "POST",
      body: variables ? JSON.stringify(variables) : undefined,
    });
  }

  async failTask(
    taskId: string,
  ): Promise<ApiResponse<{ status: string; taskId: string }>> {
    const endpoint = `/v1/tasks/fail?taskId=${encodeURIComponent(taskId)}`;
    return this.request(endpoint, { method: "POST" });
  }

  // Process endpoints
  async getProcessDefinitions(): Promise<ApiResponse<ProcessDefinition[]>> {
    return this.request("/v1/processes");
  }

  async getProcessDefinition(
    id: string,
  ): Promise<ApiResponse<ProcessDefinition>> {
    return this.request(`/v1/processes/${id}`);
  }

  async getProcessInstances(pagination?: {
    page?: number;
    size?: number;
  }): Promise<ApiResponse<ProcessInstanceDTO[]>> {
    const queryParams = new URLSearchParams();
    if (pagination?.page !== undefined)
      queryParams.append("page", String(pagination.page));
    if (pagination?.size !== undefined)
      queryParams.append("size", String(pagination.size));
    const queryString = queryParams.toString();
    return this.request(
      `/v1/processes/instances${queryString ? `?${queryString}` : ""}`,
    );
  }

  async getProcessInstance(
    instanceId: string,
  ): Promise<ApiResponse<ProcessInstanceDetailsDto>> {
    return this.request(
      `/v1/processes/instances/${encodeURIComponent(instanceId)}`,
    );
  }

  async getActivityInstances(
    instanceId: string,
  ): Promise<ApiResponse<{ childActivityInstances?: ActivityInstanceDto[] }>> {
    return this.request(
      `/v1/process-instances/${encodeURIComponent(instanceId)}/activity-instances`,
    );
  }

  async startProcess(
    processId: string,
    variables?: Record<string, unknown>,
  ): Promise<ApiResponse<{ processInstanceId: string }>> {
    const endpoint = `/v1/processes/start?processId=${encodeURIComponent(processId)}`;
    return this.request(endpoint, {
      method: "POST",
      body: variables ? JSON.stringify(variables) : undefined,
    });
  }

  async failProcessInstance(
    instanceId: string,
  ): Promise<ApiResponse<{ status: string; processInstanceId: string }>> {
    const endpoint = `/v1/processes/instance/${encodeURIComponent(instanceId)}/fail`;
    return this.request(endpoint, { method: "POST" });
  }

  async deployProcess(file: File): Promise<ApiResponse<{ status: string }>> {
    const formData = new FormData();
    formData.append("file", file);

    return this.request("/v1/processes/deploy", {
      method: "POST",
      body: formData,
    });
  }

// User stats endpoint
  async getUserStats(): Promise<ApiResponse<UserStatsDto>> {
    return this.request("/v1/tasks/user-stats");
  }

  async listForms(projectId: string): Promise<ApiResponse<ProjectResourceContentDTO[]>> {
    return this.request(`/v1/projects/${encodeURIComponent(projectId)}/resources?folder=forms`);
  }

export interface ProjectResourceContentDTO {
    id: string;
    projectId: string;
    folderId: string;
    name: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    kind: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    contentBase64: string;
  }

export const apiClient = new ApiClient();
