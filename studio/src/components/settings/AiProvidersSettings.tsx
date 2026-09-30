import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Pencil, Plug, Plus, Sparkles, Trash2, XCircle } from 'lucide-react';
import { AiConnectionTestResult, AiProvider, AiProvidersAPI } from '@/api/aiProviders';
import { AI_PROVIDER_PRESETS, isValidProviderId, parsePatterns, presetFor } from '@/lib/aiProviders';
import { setCachedModel } from '@/lib/agentModels';

interface Draft {
  id: string;
  isNew: boolean;
  providerType: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  patterns: string;
  defaultModel: string;
  enabled: boolean;
  insightDefault: boolean;
  apiKeyHint: string;
}

const inputClass = 'mt-1 w-full rounded-lg border border-[#3A322E] bg-[#14110D] px-2.5 py-2 text-xs text-[#EAE3D9] placeholder-[#5A524A] focus:border-[#2A9D8F] focus:outline-none focus:ring-1 focus:ring-[#2A9D8F]/30';

const draftFrom = (provider: AiProvider): Draft => ({
  id: provider.id,
  isNew: !provider.saved,
  providerType: provider.providerType,
  displayName: provider.displayName,
  baseUrl: provider.baseUrl ?? '',
  apiKey: '',
  patterns: provider.modelPatterns.join(', '),
  defaultModel: provider.defaultModel ?? '',
  enabled: provider.enabled,
  insightDefault: provider.insightDefault,
  apiKeyHint: provider.saved ? provider.apiKeyHint : '',
});

const draftForPreset = (type: string, existingIds: string[], hasInsightDefault: boolean): Draft => {
  const preset = presetFor(type);
  let id = preset.id;
  for (let n = 2; existingIds.includes(id); n++) id = `${preset.id}-${n}`;
  return {
    id, isNew: true, providerType: preset.type, displayName: preset.label, baseUrl: preset.baseUrl ?? '',
    apiKey: '', patterns: preset.modelPatterns.join(', '), defaultModel: preset.defaultModel ?? '',
    enabled: true, insightDefault: !hasInsightDefault, apiKeyHint: '',
  };
};

const SourceBadge: React.FC<{ provider: AiProvider }> = ({ provider }) => {
  if (provider.activeSource === 'STUDIO') {
    return <span className="rounded-full border border-[#90A955]/40 bg-[#90A955]/10 px-2 py-0.5 text-[10px] text-[#90A955]">Studio key</span>;
  }
  if (provider.activeSource === 'ENVIRONMENT') {
    return <span className="rounded-full border border-[#F4A261]/40 bg-[#F4A261]/10 px-2 py-0.5 text-[10px] text-[#F4A261]" title="Configured by environment variables on the server; a key saved here takes precedence">Environment</span>;
  }
  return <span className="rounded-full border border-[#E76F51]/40 bg-[#E76F51]/10 px-2 py-0.5 text-[10px] text-[#E76F51]">{provider.enabled ? 'No key' : 'Disabled'}</span>;
};

/**
 * Settings → AI Providers: one or more named providers whose keys serve agent
 * tasks, Insight and APL authoring. Keys are write-only; a key saved here
 * takes precedence over the server's ABADA_LLM_* environment variables.
 */
export const AiProvidersSettings: React.FC<{ onError: (message: string | null) => void }> = ({ onError }) => {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; result: AiConnectionTestResult } | null>(null);
  const [addType, setAddType] = useState(AI_PROVIDER_PRESETS[0].type);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setProviders(await AiProvidersAPI.list());
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load AI providers');
    } finally {
      setIsLoading(false);
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const hasInsightDefault = providers.some((provider) => provider.insightDefault && provider.configured);

  const save = async () => {
    if (!draft) return;
    if (!isValidProviderId(draft.id)) {
      onError('Provider id must be lowercase letters, digits and dashes.');
      return;
    }
    setIsSaving(true);
    onError(null);
    try {
      const saved = await AiProvidersAPI.save(draft.id, {
        providerType: draft.providerType,
        displayName: draft.displayName.trim() || undefined,
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey.trim() || undefined,
        modelPatterns: parsePatterns(draft.patterns),
        defaultModel: draft.defaultModel.trim(),
        enabled: draft.enabled,
        insightDefault: draft.insightDefault,
      });
      if (saved.insightDefault && saved.defaultModel) setCachedModel(saved.defaultModel);
      setDraft(null);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save AI provider');
    } finally {
      setIsSaving(false);
    }
  };

  const test = async (id: string, current?: Draft) => {
    setTesting(id);
    setTestResult(null);
    onError(null);
    try {
      const result = await AiProvidersAPI.test(id, current ? {
        providerType: current.providerType,
        baseUrl: current.baseUrl.trim() || undefined,
        apiKey: current.apiKey.trim() || undefined,
        model: current.defaultModel.trim() || undefined,
      } : undefined);
      setTestResult({ id, result });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setTesting(null);
    }
  };

  const remove = async (provider: AiProvider) => {
    const followUp = provider.environmentConfigured ? ' The environment key for this provider will apply again.' : '';
    if (!window.confirm(`Remove the saved ${provider.displayName} provider and its key?${followUp}`)) return;
    onError(null);
    try {
      await AiProvidersAPI.remove(provider.id);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to remove AI provider');
    }
  };

  const testBanner = (id: string) => testResult?.id === id && (
    <div className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${testResult.result.success
      ? 'border-[#90A955]/30 bg-[#90A955]/10 text-[#90A955]'
      : 'border-[#E76F51]/30 bg-[#E76F51]/10 text-[#E76F51]'}`}>
      {testResult.result.success ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <div className="min-w-0 break-words">
        <p>{testResult.result.message}</p>
        {(testResult.result.model || testResult.result.latencyMs) && (
          <p className="text-[10px] opacity-70">{[testResult.result.model, testResult.result.latencyMs ? `${testResult.result.latencyMs}ms` : null].filter(Boolean).join(' · ')}</p>
        )}
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-[#A89F91]">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2A9D8F]" /> Loading AI providers...
      </div>
    );
  }

  if (draft) {
    const preset = presetFor(draft.providerType);
    return (
      <div className="space-y-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-[#A89F91]">
          {draft.isNew ? `Add ${preset.label}` : `Edit ${draft.displayName}`}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[10px] text-[#A89F91]">Name
            <input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} className={inputClass} />
          </label>
          <label className="block text-[10px] text-[#A89F91]">Id
            <input value={draft.id} disabled={!draft.isNew} onChange={(e) => setDraft({ ...draft, id: e.target.value.trim().toLowerCase() })}
              className={`${inputClass} font-mono disabled:opacity-60`} />
          </label>
        </div>
        <label className="block text-[10px] text-[#A89F91]">API key
          <input type="password" autoComplete="off" value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder={draft.apiKeyHint ? `Saved ${draft.apiKeyHint} — leave blank to keep` : preset.keyHelp}
            className={inputClass} />
        </label>
        <label className="block text-[10px] text-[#A89F91]">Base URL
          <input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder={preset.baseUrl ?? 'https://llm-gateway.example.com/v1'} className={`${inputClass} font-mono`} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[10px] text-[#A89F91]">Default model
            <input value={draft.defaultModel} onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })}
              placeholder={preset.defaultModel ?? 'model id'} className={`${inputClass} font-mono`} />
          </label>
          <label className="block text-[10px] text-[#A89F91]" title="Agent models that start with one of these prefixes use this provider; * matches any model">Serves models starting with
            <input value={draft.patterns} onChange={(e) => setDraft({ ...draft, patterns: e.target.value })}
              placeholder="gemini, google/" className={`${inputClass} font-mono`} />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-[#EAE3D9]">
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.insightDefault} onChange={(e) => setDraft({ ...draft, insightDefault: e.target.checked })} /> Used by Insight and authoring</label>
        </div>
        {testBanner(draft.id)}
        <div className="flex gap-2">
          <button type="button" onClick={() => setDraft(null)}
            className="flex-1 rounded-lg border border-[#3A322E] py-2 text-xs text-[#A89F91] hover:bg-[#2F2926] hover:text-[#EAE3D9]">Cancel</button>
          <button type="button" onClick={() => void test(draft.id, draft)} disabled={testing !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#3A322E] py-2 text-xs text-[#A89F91] hover:bg-[#2F2926] hover:text-[#EAE3D9] disabled:opacity-50">
            {testing === draft.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Test
          </button>
          <button type="button" onClick={() => void save()} disabled={isSaving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#2A9D8F]/50 bg-[#2A9D8F]/15 py-2 text-xs font-medium text-[#2A9D8F] disabled:opacity-50">
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {providers.length === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[#E76F51]/30 bg-[#E76F51]/10 px-3 py-2.5 text-xs text-[#E76F51]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          No AI provider is configured. Agent nodes cannot run until you add one.
        </div>
      )}
      {providers.map((provider) => (
        <div key={provider.id} className="rounded-lg border border-[#3A322E] bg-[#14110D] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-medium text-[#EAE3D9]">{provider.displayName}</span>
            <SourceBadge provider={provider} />
            {provider.insightDefault && provider.configured && (
              <span className="flex items-center gap-1 text-[10px] text-[#9D4EDD]" title="Insight and APL authoring use this provider"><Sparkles className="h-3 w-3" /> Insight</span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => void test(provider.id)} disabled={testing !== null || !provider.configured} title="Test connection"
                className="rounded-md p-1.5 text-[#A89F91] hover:bg-[#2F2926] hover:text-[#EAE3D9] disabled:opacity-40">
                {testing === provider.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
              </button>
              <button type="button" onClick={() => setDraft(draftFrom(provider))} title={provider.saved ? 'Edit' : 'Save a key in Studio for this provider'}
                className="rounded-md p-1.5 text-[#A89F91] hover:bg-[#2F2926] hover:text-[#EAE3D9]"><Pencil className="h-3.5 w-3.5" /></button>
              {provider.saved && (
                <button type="button" onClick={() => void remove(provider)} title="Remove"
                  className="rounded-md p-1.5 text-[#A89F91] hover:bg-[#2F2926] hover:text-[#E76F51]"><Trash2 className="h-3.5 w-3.5" /></button>
              )}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-[#A89F91]">
            <span>{provider.saved ? (provider.apiKeyHint || 'no key') : `env ${provider.environmentKeyHint ?? ''}`}</span>
            {provider.defaultModel && <span>{provider.defaultModel}</span>}
            <span title="Agent models routed to this provider">→ {provider.modelPatterns.join(', ')}</span>
          </div>
          {testBanner(provider.id)}
        </div>
      ))}

      <div className="flex gap-2">
        <select value={addType} onChange={(e) => setAddType(e.target.value)} aria-label="Provider to add"
          className="flex-1 rounded-lg border border-[#3A322E] bg-[#14110D] px-2.5 py-2 text-xs text-[#EAE3D9]">
          {AI_PROVIDER_PRESETS.map((preset) => <option key={preset.type} value={preset.type}>{preset.label}</option>)}
        </select>
        <button type="button"
          onClick={() => setDraft(draftForPreset(addType, providers.map((provider) => provider.id), hasInsightDefault))}
          className="flex items-center gap-1.5 rounded-lg border border-[#2A9D8F]/50 bg-[#2A9D8F]/15 px-3 py-2 text-xs font-medium text-[#2A9D8F]">
          <Plus className="h-3.5 w-3.5" /> Add provider
        </button>
      </div>

      <div className="space-y-1 rounded-lg bg-[#25201D] p-3 text-[10px] text-[#A89F91]">
        <p className="font-medium text-[#EAE3D9]">How keys are used</p>
        <p>Agent tasks, Insight and APL authoring all use these providers. Each agent node's model goes to the provider whose prefix matches it.</p>
        <p>A key saved here takes precedence over the server's <code className="text-[#F4A261]">ABADA_LLM_*</code> environment variables, which remain a developer fallback.</p>
      </div>
    </div>
  );
};
