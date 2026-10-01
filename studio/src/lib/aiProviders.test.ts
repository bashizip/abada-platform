import { describe, expect, it } from 'vitest';
import { agentModelsOf, describeRouting, isValidProviderId, keyStatusOf, missingProviderMessage, modelsFor, parsePatterns, presetFor } from './aiProviders';

describe('AI provider helpers', () => {
  it('collects distinct agent models only', () => {
    expect(agentModelsOf([
      { type: 'agent', agentConfig: { model: 'gemini-3.6-flash' } },
      { type: 'agent', agentConfig: { model: ' gemini-3.6-flash ' } },
      { type: 'agent', agentConfig: { model: 'claude-sonnet-5' } },
      { type: 'userTask' },
      { type: 'agent' },
    ])).toEqual(['gemini-3.6-flash', 'claude-sonnet-5']);
  });

  it('normalises model patterns', () => {
    expect(parsePatterns(' Claude, anthropic/ ,claude,, ')).toEqual(['claude', 'anthropic/']);
  });

  it('validates provider ids like the engine', () => {
    expect(isValidProviderId('local-gateway')).toBe(true);
    expect(isValidProviderId('Bad_Id')).toBe(false);
    expect(isValidProviderId('-x')).toBe(false);
  });

  it('falls back to the custom preset for unknown types', () => {
    expect(presetFor('gemini').baseUrl).toContain('/v1beta/openai');
    expect(presetFor('nope').type).toBe('openai-compatible');
  });

  it('names the models without a provider', () => {
    expect(missingProviderMessage(['claude-sonnet-5'])).toContain('model claude-sonnet-5');
    expect(missingProviderMessage(['a', 'b'])).toContain('models a, b');
    expect(missingProviderMessage([])).toContain('Settings → AI Providers');
  });

  it('describes routing in words', () => {
    expect(describeRouting(['gemini', 'google/'])).toBe('models starting with gemini, google/');
    expect(describeRouting(['*'])).toBe('every model no other provider serves');
  });

  it('suggests the models a provider serves, its default first', () => {
    const known = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gpt-5-mini'];
    expect(modelsFor(['gemini'], 'gemini-3.8-flash', known)).toEqual(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.7-flash']);
    expect(modelsFor(['*'], null, known)).toEqual(known);
  });

  it('says where a key comes from', () => {
    expect(keyStatusOf({ enabled: true, activeSource: 'STUDIO' })).toBe('studio');
    expect(keyStatusOf({ enabled: true, activeSource: 'ENVIRONMENT' })).toBe('environment');
    expect(keyStatusOf({ enabled: true, activeSource: null })).toBe('missing');
    expect(keyStatusOf({ enabled: false, activeSource: 'STUDIO' })).toBe('disabled');
  });
});
