import { config } from '@/config/runtime';
import { apiError, authenticatedFetch } from '@/api/authenticatedFetch';

/** A model price in USD per million tokens, in effect from `effectiveFrom`. */
export interface ModelPrice {
  id: string;
  model: string;
  provider: string | null;
  inputPerMillion: number;
  outputPerMillion: number;
  effectiveFrom: string;
  createdBy: string;
  createdAt: string;
}

export interface ModelPriceRequest {
  model: string;
  provider?: string;
  inputPerMillion: number;
  outputPerMillion: number;
  /** ISO instant; now when omitted. */
  effectiveFrom?: string;
}

/** What a project's agent evidence keeps: payloads none | redacted | full, for retentionDays. */
export interface EvidencePolicy {
  payloads: 'none' | 'redacted' | 'full';
  retentionDays: number;
}

/** One journaled agent step as project members see it (no payloads). */
export interface AgentStepEvidence {
  id: string;
  externalTaskId: string;
  activityId: string;
  attempt: number;
  sequence: number;
  kind: 'MODEL_CALL' | 'TOOL_CALL' | 'DELEGATION';
  toolRef?: string;
  policy?: string;
  state: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  costUnpriced: boolean;
  payloadMode: string;
  startedAt: string;
  finishedAt?: string;
  purgedAt?: string;
  /** Who approved or rejected a PROPOSED step, and when. */
  resolvedBy?: string;
  decidedAt?: string;
  /** The child process a DELEGATION step started. */
  childInstanceId?: string;
  errorType?: string;
}

/** The evidence copy of one step's payloads, as the evidence policy kept them. */
export interface AgentStepPayloads {
  stepId: string;
  payloadMode: 'none' | 'redacted' | 'full';
  request?: unknown;
  result?: unknown;
}

const json = { 'Content-Type': 'application/json' };

export class EvidenceAPI {
  static async prices(): Promise<ModelPrice[]> {
    const res = await authenticatedFetch(`${config.apiUrl}/v1/model-prices`);
    if (!res.ok) throw await apiError(res);
    return res.json();
  }

  static async addPrice(request: ModelPriceRequest): Promise<ModelPrice> {
    const res = await authenticatedFetch(`${config.apiUrl}/v1/model-prices`, {
      method: 'POST', headers: json, body: JSON.stringify(request),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  }

  static async deletePrice(id: string): Promise<void> {
    const res = await authenticatedFetch(`${config.apiUrl}/v1/model-prices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw await apiError(res);
  }

  static async policy(projectId: string): Promise<EvidencePolicy> {
    const res = await authenticatedFetch(`${config.apiUrl}/v1/projects/${projectId}/evidence-policy`);
    if (!res.ok) throw await apiError(res);
    return res.json();
  }

  static async setPolicy(projectId: string, policy: EvidencePolicy): Promise<EvidencePolicy> {
    const res = await authenticatedFetch(`${config.apiUrl}/v1/projects/${projectId}/evidence-policy`, {
      method: 'PUT', headers: json, body: JSON.stringify(policy),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  }

  /** Evidence readers only (403 otherwise); every read is recorded in the instance history. */
  static async payloads(projectId: string, instanceId: string, stepId: string): Promise<AgentStepPayloads> {
    const res = await authenticatedFetch(`${config.apiUrl}/v1/projects/${projectId}/instances/`
      + `${encodeURIComponent(instanceId)}/agent-steps/${encodeURIComponent(stepId)}/payloads`);
    if (!res.ok) throw await apiError(res);
    return res.json();
  }

  static async steps(projectId: string, instanceId: string): Promise<AgentStepEvidence[]> {
    const res = await authenticatedFetch(
      `${config.apiUrl}/v1/projects/${projectId}/instances/${encodeURIComponent(instanceId)}/agent-steps`);
    if (!res.ok) throw await apiError(res);
    return res.json();
  }
}

/** `$0.0042` with up to 4 decimals; small amounts keep their precision. */
export const formatUsd = (usd: number | undefined | null): string => {
  if (usd === undefined || usd === null) return '—';
  const digits = usd !== 0 && Math.abs(usd) < 0.01 ? 4 : 2;
  return `$${usd.toFixed(digits)}`;
};
