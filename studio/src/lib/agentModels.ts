/**
 * Agent node LLM models. `DEFAULT_AGENT_MODEL` mirrors the platform default the
 * engine/worker fall back to (gemini-3.6-flash), and `AGENT_MODEL_OPTIONS` feeds
 * the node settings panel's model selector. The panel always appends the node's
 * current APL model to the options when it is not in the curated list, so the
 * dropdown and the APL YAML stay in sync for any provider/model id.
 *
 * `ALLOWED_AGENT_MODELS` is the deployment gate: the engine rejects APL whose
 * agent nodes declare a model outside this list, and the studio blocks both
 * Dry Run and Deploy & Start with the same message.
 */
export const DEFAULT_AGENT_MODEL = 'gemini-3.6-flash';

export const AGENT_MODEL_OPTIONS: string[] = [
  DEFAULT_AGENT_MODEL,
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
      `Agent node "${issue.nodeTitle}" declares model "${issue.model}" which is not on the allowed model list (${ALLOWED_AGENT_MODELS.join(', ')}).`)
    .join(' ');

/** Returns true if the workflow contains at least one agent node. */
export const hasAgentNodes = (nodes: { type: string }[]): boolean =>
  nodes.some((node) => node.type === 'agent');
