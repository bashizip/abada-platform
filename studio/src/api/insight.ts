import { config } from '@/config/runtime';
import { authenticatedFetch } from '@/api/authenticatedFetch';
import { aplToWorkflow, parseAPLYaml } from '@/lib/apl/parser';
import { WorkflowDiffSnapshot, DiffNodeChange, DiffEdgeChange } from '@/lib/aiDiff/types';

export interface InsightLlmConfig {
  enabled: boolean;
  configured: boolean;
  providerType: string;
  baseUrl: string;
  model: string;
  openRouterEnabled: boolean;
  openRouterReferer: string;
  openRouterTitle: string;
}

export interface AiProviderSettings {
  configured: boolean;
  providerType: string;
  baseUrl: string;
  model: string;
  apiKeyHint: string;
  enabled: boolean;
}

export interface SaveAiProviderRequest {
  providerType?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  enabled?: boolean;
}

export interface LlmConnectionTestResult {
  success: boolean;
  status: 'READY' | 'NOT_CONFIGURED' | 'ERROR';
  latencyMs?: number;
  model?: string;
  message: string;
}

export interface InsightProposalSummary {
  id: number;
  definitionKey: string;
  targetVersion: number;
  status: string;
  rationale: string;
  requiredApprovals: number;
  requiredGroups: string;
  approvalMode: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsightProposalDetail extends InsightProposalSummary {
  targetChecksum: string;
  targetSource: string;
  proposedSource: string;
  adoptedDeploymentId?: string;
  adoptedVersion?: number;
  reviews: Array<{ id: number; actor: string; decision: string; comment?: string; createdAt: string }>;
}

export interface InsightProposalPage {
  items: InsightProposalSummary[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface InsightApprovalPolicy {
  definitionKey: string;
  policyVersion: number;
  requiredApprovals: number;
  requiredGroups: string;
  approvalMode: 'PARALLEL' | 'SEQUENTIAL';
  updatedAt: string;
  updatedBy: string;
}

export class InsightAPI {
  private static readonly BASE_URL = `${config.apiUrl}/v1`;

  private static getHeaders(): HeadersInit {
    const headers: HeadersInit = {};
    headers['Content-Type'] = 'application/json';
    return headers;
  }

  /**
   * Retrieves the current LLM provider configuration for the Insight Engine.
   * The API key is never returned; its presence is indicated by `configured`.
   */
  static async getLlmConfig(): Promise<InsightLlmConfig> {
    const res = await authenticatedFetch(`${this.BASE_URL}/insight/config/llm`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch LLM config: ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Performs a live connection test to the configured Gemini / LLM provider.
   */
  static async testLlmConnection(): Promise<LlmConnectionTestResult> {
    const res = await authenticatedFetch(`${this.BASE_URL}/insight/config/llm/test`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Connection test failed: ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Retrieves the saved AI provider settings from the database.
   */
  static async getAiSettings(): Promise<AiProviderSettings> {
    const res = await authenticatedFetch(`${this.BASE_URL}/insight/config/ai`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch AI settings: ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Saves AI provider settings. The API key is encrypted server-side.
   */
  static async saveAiSettings(request: SaveAiProviderRequest): Promise<AiProviderSettings> {
    const res = await authenticatedFetch(`${this.BASE_URL}/insight/config/ai`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      throw new Error(`Failed to save AI settings: ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Tests the AI provider connection with saved or provided settings.
   */
  static async testAiConnection(overrides?: Partial<SaveAiProviderRequest>): Promise<LlmConnectionTestResult> {
    const res = await authenticatedFetch(`${this.BASE_URL}/insight/config/ai/test`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: overrides ? JSON.stringify(overrides) : undefined,
    });
    if (!res.ok) {
      throw new Error(`AI connection test failed: ${res.statusText}`);
    }
    return res.json();
  }

  static async listProposals(definitionKey?: string, projectId?: string): Promise<InsightProposalPage> {
    const query = new URLSearchParams({ page: '0', size: '20' });
    if (definitionKey) query.set('definitionKey', definitionKey);
    const scope = projectId ? `/projects/${projectId}/insight` : '/insight';
    const res = await authenticatedFetch(`${this.BASE_URL}${scope}/proposals?${query}`, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch Insight proposals: ${res.statusText}`);
    return res.json();
  }

  static async getProposal(id: number, projectId?: string): Promise<InsightProposalDetail> {
    const scope = projectId ? `/projects/${projectId}/insight` : '/insight';
    const res = await authenticatedFetch(`${this.BASE_URL}${scope}/proposals/${id}`, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch Insight proposal: ${res.statusText}`);
    return res.json();
  }

  static async getPolicy(definitionKey: string, projectId?: string): Promise<InsightApprovalPolicy> {
    const scope = projectId ? `/projects/${projectId}/insight` : '/insight';
    const res = await authenticatedFetch(`${this.BASE_URL}${scope}/policies/${encodeURIComponent(definitionKey)}`,
      { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch approval policy: ${res.statusText}`);
    return res.json();
  }

  static async updatePolicy(policy: InsightApprovalPolicy, projectId?: string): Promise<InsightApprovalPolicy> {
    const scope = projectId ? `/projects/${projectId}/insight` : '/insight';
    const body = projectId ? {
      expectedVersion: policy.policyVersion, requiredApprovals: policy.requiredApprovals,
      requiredLanes: policy.requiredGroups.split(',').map((value) => value.replace(/^lane:/i, '').trim()),
      approvalMode: policy.approvalMode,
    } : {
      expectedVersion: policy.policyVersion, requiredApprovals: policy.requiredApprovals,
      requiredGroups: policy.requiredGroups, approvalMode: policy.approvalMode,
    };
    const res = await authenticatedFetch(`${this.BASE_URL}${scope}/policies/${encodeURIComponent(policy.definitionKey)}`, {
      method: 'PUT', headers: this.getHeaders(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update approval policy: ${res.statusText} - ${await res.text()}`);
    return res.json();
  }

  static async reviewProposal(id: number, decision: 'APPROVE' | 'REJECT',
    comment: string, expectedUpdatedAt: string, projectId?: string): Promise<InsightProposalDetail> {
    const scope = projectId ? `/projects/${projectId}/insight` : '/insight';
    const res = await authenticatedFetch(`${this.BASE_URL}${scope}/proposals/${id}/reviews`, {
      method: 'POST', headers: this.getHeaders(),
      body: JSON.stringify({ decision, comment, expectedUpdatedAt }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Insight review failed: ${res.statusText} - ${body}`);
    }
    return res.json();
  }

  static toDiffSnapshot(detail: InsightProposalDetail): WorkflowDiffSnapshot {
    const base = aplToWorkflow(parseAPLYaml(detail.targetSource));
    const proposed = aplToWorkflow(parseAPLYaml(detail.proposedSource));
    const baseById = new Map(base.nodes.map((node) => [node.id, node]));
    const proposedById = new Map(proposed.nodes.map((node) => [node.id, node]));
    const nodeChanges: DiffNodeChange[] = [];
    for (const node of proposed.nodes) {
      const previous = baseById.get(node.id);
      if (!previous) nodeChanges.push({ nodeId: node.id, kind: 'added' });
      else if (JSON.stringify({ ...previous, x: 0, y: 0 }) !== JSON.stringify({ ...node, x: 0, y: 0 })) {
        nodeChanges.push({ nodeId: node.id, kind: 'modified', annotation: '# Insight optimization proposal' });
      }
    }
    for (const node of base.nodes) if (!proposedById.has(node.id)) nodeChanges.push({ nodeId: node.id, kind: 'removed' });
    const baseEdges = new Map(base.edges.map((edge) => [`${edge.source}->${edge.target}:${edge.label || ''}`, edge]));
    const proposedEdges = new Map(proposed.edges.map((edge) => [`${edge.source}->${edge.target}:${edge.label || ''}`, edge]));
    const edgeChanges: DiffEdgeChange[] = [];
    for (const [key, edge] of proposedEdges) if (!baseEdges.has(key)) edgeChanges.push({ edgeId: edge.id, kind: 'added' });
    for (const [key, edge] of baseEdges) if (!proposedEdges.has(key)) edgeChanges.push({ edgeId: edge.id, kind: 'removed' });
    return {
      proposal: {
        id: String(detail.id), title: `OPTIMIZATION PROPOSAL #${detail.id}`,
        rationale: detail.rationale, source: 'Insight Engine (PostgreSQL Facts)',
        targetDefinition: `${detail.definitionKey}_v${detail.targetVersion}`,
        createdAt: detail.createdAt, nodeChanges, edgeChanges,
      },
      baseNodes: base.nodes, baseEdges: base.edges,
      proposedNodes: proposed.nodes, proposedEdges: proposed.edges,
      backend: { id: detail.id, status: detail.status, updatedAt: detail.updatedAt,
        proposedSource: detail.proposedSource },
    };
  }
}
