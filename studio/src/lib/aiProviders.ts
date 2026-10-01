/**
 * Provider presets offered in Settings → AI Providers. They mirror the
 * engine's `AiProviderType` presets: every provider is called through its
 * OpenAI-compatible `/chat/completions` endpoint, and models route to the
 * provider whose prefix pattern is the longest match (`*` matches any model).
 */
export interface AiProviderPreset {
  type: string;
  label: string;
  /** Suggested id for a new provider of this type. */
  id: string;
  baseUrl: string | null;
  modelPatterns: string[];
  defaultModel: string | null;
  keyHelp: string;
}

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  { type: 'gemini', label: 'Google Gemini', id: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', modelPatterns: ['gemini', 'google/'], defaultModel: 'gemini-3.6-flash', keyHelp: 'Google AI Studio API key' },
  { type: 'openai', label: 'OpenAI', id: 'openai', baseUrl: 'https://api.openai.com/v1', modelPatterns: ['gpt-', 'o1', 'o3', 'o4', 'openai/'], defaultModel: 'gpt-5-mini', keyHelp: 'OpenAI API key' },
  { type: 'anthropic', label: 'Anthropic', id: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', modelPatterns: ['claude', 'anthropic/'], defaultModel: 'claude-sonnet-5', keyHelp: 'Anthropic API key' },
  { type: 'deepseek', label: 'DeepSeek', id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', modelPatterns: ['deepseek-'], defaultModel: 'deepseek-chat', keyHelp: 'DeepSeek API key' },
  { type: 'openrouter', label: 'OpenRouter', id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', modelPatterns: ['deepseek/', 'meta-llama/', 'mistralai/', 'qwen/', 'x-ai/', 'openrouter/'], defaultModel: 'deepseek/deepseek-v4-flash-free', keyHelp: 'OpenRouter API key' },
  { type: 'openai-compatible', label: 'Custom (OpenAI-compatible)', id: 'custom', baseUrl: null, modelPatterns: ['*'], defaultModel: null, keyHelp: 'Gateway API key' },
];

export const presetFor = (type: string): AiProviderPreset =>
  AI_PROVIDER_PRESETS.find((preset) => preset.type === type) ?? AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1];

/** Splits a comma-separated pattern field into normalised, de-duplicated prefixes. */
export const parsePatterns = (value: string): string[] =>
  Array.from(new Set(value.split(',').map((pattern) => pattern.trim().toLowerCase()).filter(Boolean)));

/** Lowercase letters, digits and dashes, as the engine requires for provider ids. */
export const isValidProviderId = (value: string): boolean => /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);

/** Distinct models declared by the workflow's agent nodes. */
export const agentModelsOf = (nodes: { type: string; agentConfig?: { model?: string } }[]): string[] =>
  Array.from(new Set(nodes
    .filter((node) => node.type === 'agent')
    .map((node) => node.agentConfig?.model?.trim())
    .filter((model): model is string => !!model)));

/** The message shown when agent models have no configured provider. */
export const missingProviderMessage = (models: string[]): string =>
  models.length === 0
    ? 'This workflow contains AI agent nodes but no AI provider is configured. Go to Settings → AI Providers to add one.'
    : `No AI provider is configured for model${models.length > 1 ? 's' : ''} ${models.join(', ')}. Go to Settings → AI Providers to add the provider and its API key.`;

/** "every model no other provider serves" for a catch-all, else the prefixes in words. */
export const describeRouting = (patterns: string[]): string => {
  const prefixes = patterns.filter((pattern) => pattern !== '*');
  const catchAll = patterns.includes('*');
  if (prefixes.length === 0) return catchAll ? 'every model no other provider serves' : 'no models';
  const listed = `models starting with ${prefixes.join(', ')}`;
  return catchAll ? `${listed}, and every model no other provider serves` : listed;
};

/** Known model ids this provider would serve, its own default model first. */
export const modelsFor = (patterns: string[], defaultModel: string | null, known: readonly string[]): string[] => {
  const matches = known.filter((model) => patterns.includes('*')
    || patterns.some((pattern) => model.toLowerCase().startsWith(pattern)));
  return Array.from(new Set([defaultModel, ...matches].filter((model): model is string => !!model)));
};

export type KeyStatus = 'studio' | 'environment' | 'missing' | 'disabled';

/** Where a provider's key comes from, as the engine resolved it. */
export const keyStatusOf = (provider: { enabled: boolean; activeSource: 'STUDIO' | 'ENVIRONMENT' | null }): KeyStatus =>
  !provider.enabled ? 'disabled'
    : provider.activeSource === 'STUDIO' ? 'studio'
      : provider.activeSource === 'ENVIRONMENT' ? 'environment'
        : 'missing';
