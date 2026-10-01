/**
 * Agent node LLM models. The default model for new agent nodes is the
 * default model of the provider Insight uses (Settings → AI Providers).
 * Falls back to gemini-3.6-flash if no provider is configured yet.
 *
 * The allowed models come from the engine's served APL contract
 * (`GET /v1/apl/schema`, configured by `abada.agent.allowed-models`); Studio
 * keeps no copy of that list. Until the contract loads the guard below is
 * skipped, and the engine still rejects a disallowed model at deployment.
 */
import { AiProvidersAPI } from '@/api/aiProviders';
import { aplContract } from '@/lib/aplContract';

const FALLBACK_DEFAULT_MODEL = 'gemini-3.6-flash';

/** Cached model from the saved AI provider settings. */
let cachedModel: string | null = null;

/** Synchronous default — returns cached value or fallback. */
export function getDefaultAgentModel(): string {
  return cachedModel ?? FALLBACK_DEFAULT_MODEL;
}

/** Load the saved model from the API. Call once at app startup. */
export async function initAgentModel(): Promise<string> {
  try {
    const status = await AiProvidersAPI.status();
    if (status.insightModel && status.insightModel.trim()) {
      cachedModel = status.insightModel.trim();
    }
  } catch {
    // API unavailable — keep fallback
  }
  return getDefaultAgentModel();
}

/**
 * Update the cached model after the user saves settings in the panel.
 * Avoids a round-trip on the next node creation.
 */
export function setCachedModel(model: string): void {
  if (model && model.trim()) {
    cachedModel = model.trim();
  }
}

/** Models this engine allows; empty until the APL contract has loaded. */
export const allowedAgentModels = (): readonly string[] => aplContract()?.allowedAgentModels ?? [];

/** Selector options: the allowed models, or the default model while the contract is unknown. */
export const agentModelOptions = (allowed: readonly string[] = allowedAgentModels()): string[] =>
  allowed.length > 0 ? [...allowed] : [getDefaultAgentModel()];

export interface InvalidAgentModel {
  nodeId: string;
  nodeTitle: string;
  model: string;
}

export const invalidAgentModels = (nodes: { id: string; title: string; type: string; agentConfig?: { model?: string } }[],
  allowed: readonly string[] = allowedAgentModels()): InvalidAgentModel[] =>
  allowed.length === 0 ? [] : nodes
    .filter((node) => node.type === 'agent' && node.agentConfig?.model)
    .map((node) => ({ nodeId: node.id, nodeTitle: node.title, model: node.agentConfig!.model!.trim() }))
    .filter((item) => !allowed.includes(item.model));

export const agentModelGuardMessage = (issues: InvalidAgentModel[],
  allowed: readonly string[] = allowedAgentModels()): string =>
  issues
    .map((issue) =>
      `Agent node "${issue.nodeTitle}" declares model "${issue.model}" which is not on the allowed model list (${allowed.join(', ')}).`
    )
    .join(' ');

/** Returns true if the workflow contains at least one agent node. */
export const hasAgentNodes = (nodes: { type: string }[]): boolean =>
  nodes.some((node) => node.type === 'agent');
