/**
 * Agent node LLM models. The default model is dynamically loaded from
 * the AI provider settings saved in the Settings panel (database-backed).
 * Falls back to gemini-3.6-flash if no settings are saved yet.
 *
 * `AGENT_MODEL_OPTIONS` feeds the node settings panel's model selector.
 * `ALLOWED_AGENT_MODELS` is the deployment gate: the engine rejects APL
 * whose agent nodes declare a model outside this list.
 */
import { InsightAPI } from '@/api/insight';

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
    const settings = await InsightAPI.getAiSettings();
    if (settings.model && settings.model.trim()) {
      cachedModel = settings.model.trim();
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

export const AGENT_MODEL_OPTIONS: string[] = [
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'deepseek/deepseek-v4-flash-free',
  'gpt-5-mini',
];

export const ALLOWED_AGENT_MODELS: readonly string[] = AGENT_MODEL_OPTIONS;

export interface InvalidAgentModel {
  nodeId: string;
  nodeTitle: string;
  model: string;
}

export const invalidAgentModels = (nodes: { id: string; title: string; type: string; agentConfig?: { model?: string } }[]): InvalidAgentModel[] =>
  nodes
    .filter((node) => node.type === 'agent' && node.agentConfig?.model)
    .map((node) => ({ nodeId: node.id, nodeTitle: node.title, model: node.agentConfig!.model!.trim() }))
    .filter((item) => !ALLOWED_AGENT_MODELS.includes(item.model));

export const agentModelGuardMessage = (issues: InvalidAgentModel[]): string =>
  issues
    .map((issue) =>
      `Agent node "${issue.nodeTitle}" declares model "${issue.model}" which is not on the allowed model list (${ALLOWED_AGENT_MODELS.join(', ')}).`
    )
    .join(' ');

/** Returns true if the workflow contains at least one agent node. */
export const hasAgentNodes = (nodes: { type: string }[]): boolean =>
  nodes.some((node) => node.type === 'agent');
