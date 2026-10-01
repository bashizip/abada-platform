import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, Pencil, Plug, Plus, Sparkles, Trash2, XCircle } from 'lucide-react';
import { AiConnectionTestResult, AiProvider, AiProvidersAPI, AiProvidersStatus } from '@/api/aiProviders';
import {
  AI_PROVIDER_PRESETS, describeRouting, isValidProviderId, keyStatusOf, modelsFor, parsePatterns, presetFor,
} from '@/lib/aiProviders';
import { agentModelOptions, setCachedModel } from '@/lib/agentModels';

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
  apiKeyHint: string;
  environmentKeyHint: string | null;
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
  apiKeyHint: provider.saved ? provider.apiKeyHint : '',
  environmentKeyHint: provider.environmentConfigured ? provider.environmentKeyHint : null,
});

const draftForPreset = (type: string, existingIds: string[]): Draft => {
  const preset = presetFor(type);
  let id = preset.id;
  for (let n = 2; existingIds.includes(id); n++) id = `${preset.id}-${n}`;
  return {
    id, isNew: true, providerType: preset.type, displayName: preset.label, baseUrl: preset.baseUrl ?? '',
    apiKey: '', patterns: preset.modelPatterns.join(', '), defaultModel: preset.defaultModel ?? '',
    enabled: true, apiKeyHint: '', environmentKeyHint: null,
  };
};

/** Where the provider's key comes from, in plain words. */
const KeyChip: React.FC<{ provider: AiProvider }> = ({ provider }) => {
  switch (keyStatusOf(provider)) {
    case 'studio':
      return <span className="rounded-full border border-[#90A955]/40 bg-[#90A955]/10 px-2 py-0.5 text-[10px] text-[#90A955]">Key saved in Studio {provider.apiKeyHint}</span>;
    case 'environment':
      return <span className="rounded-full border border-[#2A9D8F]/40 bg-[#2A9D8F]/10 px-2 py-0.5 text-[10px] text-[#2A9D8F]" title="The key is set in the server's environment file; saving a key here overrides it">Key from server {provider.environmentKeyHint}</span>;
    case 'disabled':
      return <span className="rounded-full border border-[#3A322E] px-2 py-0.5 text-[10px] text-[#A89F91]">Disabled</span>;
    default:
      return <span className="rounded-full border border-[#E76F51]/40 bg-[#E76F51]/10 px-2 py-0.5 text-[10px] text-[#E76F51]">No key — not used</span>;
  }
};

/**
 * Settings → AI Providers. The top section picks the default provider and
 * model (Insight, APL authoring and new agent nodes); below, each provider
 * says where its key comes from and which agent models it serves. Keys are
 * write-only; a key saved here overrides the server's environment key.
 */
export const AiProvidersSettings: React.FC<{ onError: (message: string | null) => void }> = ({ onError }) => {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [status, setStatus] = useState<AiProvidersStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; result: AiConnectionTestResult } | null>(null);
  const [addType, setAddType] = useState(AI_PROVIDER_PRESETS[0].type);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [defaultId, setDefaultId] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [savingDefault, setSavingDefault] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [list, current] = await Promise.all([AiProvidersAPI.list(), AiProvidersAPI.status()]);
      setProviders(list);
      setStatus(current);
      const chosenId = current.requestedInsightProviderId ?? current.insightProviderId ?? '';
      const chosen = list.find((provider) => provider.id === chosenId);
      setDefaultId(chosenId);
      setDefaultModel(chosen?.defaultModel ?? current.insightModel ?? '');
      if (current.insightModel) setCachedModel(current.insightModel);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load AI providers');
    } finally {
      setIsLoading(false);
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const edit = (next: Draft | null) => {
    setTestResult(null);
    setConfirmRemove(null);
    setDraft(next);
  };

  const byId = (id: string | null | undefined) => providers.find((provider) => provider.id === id);
  const effective = byId(status?.insightProviderId);
  const requested = byId(status?.requestedInsightProviderId);
  const chosenForDefault = byId(defaultId);
  const defaultChanged = !!chosenForDefault && (defaultId !== (status?.requestedInsightProviderId ?? status?.insightProviderId)
    || defaultModel.trim() !== (chosenForDefault.defaultModel ?? ''));

  const saveDefault = async () => {
    if (!chosenForDefault) return;
    setSavingDefault(true);
    onError(null);
    try {
      await AiProvidersAPI.save(chosenForDefault.id, {
        providerType: chosenForDefault.providerType,
        defaultModel: defaultModel.trim(),
        insightDefault: true,
        enabled: true,
      });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save the default model');
    } finally {
      setSavingDefault(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (!isValidProviderId(draft.id)) {
      onError('Provider id must be lowercase letters, digits and dashes.');
      return;
    }
    setIsSaving(true);
    onError(null);
    try {
      await AiProvidersAPI.save(draft.id, {
        providerType: draft.providerType,
        displayName: draft.displayName.trim() || undefined,
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey.trim() || undefined,
        modelPatterns: parsePatterns(draft.patterns),
        defaultModel: draft.defaultModel.trim(),
        enabled: draft.enabled,
      });
      edit(null);
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
    setConfirmRemove(null);
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
    const keyPlaceholder = draft.apiKeyHint
      ? `Saved ${draft.apiKeyHint} — leave blank to keep it`
      : draft.environmentKeyHint
        ? `Uses the server key ${draft.environmentKeyHint} — enter a key to override it`
        : preset.keyHelp;
    return (
      <div className="space-y-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-[#A89F91]">
          {draft.isNew && !draft.environmentKeyHint ? `Add ${preset.label}` : `Edit ${draft.displayName}`}
        </h3>
        <label className="block text-[10px] text-[#A89F91]">API key
          <input type="password" autoComplete="off" value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder={keyPlaceholder} className={inputClass} />
        </label>
        <label className="block text-[10px] text-[#A89F91]">Default model
          <input value={draft.defaultModel} list="ai-provider-draft-models"
            onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })}
            placeholder={preset.defaultModel ?? 'model id'} className={`${inputClass} font-mono`} />
          <datalist id="ai-provider-draft-models">
            {modelsFor(parsePatterns(draft.patterns), null, agentModelOptions()).map((model) => <option key={model} value={model} />)}
          </datalist>
        </label>
        <details className="rounded-lg border border-[#3A322E] px-3 py-2 text-[10px] text-[#A89F91]" open={draft.providerType === 'openai-compatible'}>
          <summary className="cursor-pointer select-none text-[#EAE3D9]">Advanced</summary>
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">Name
                <input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} className={inputClass} />
              </label>
              <label className="block">Id
                <input value={draft.id} disabled={!draft.isNew || !!draft.environmentKeyHint} onChange={(e) => setDraft({ ...draft, id: e.target.value.trim().toLowerCase() })}
                  className={`${inputClass} font-mono disabled:opacity-60`} />
              </label>
            </div>
            <label className="block">Base URL
              <input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder={preset.baseUrl ?? 'https://llm-gateway.example.com/v1'} className={`${inputClass} font-mono`} />
            </label>
            <label className="block">Agent models it serves (prefixes, comma-separated)
              <input value={draft.patterns} onChange={(e) => setDraft({ ...draft, patterns: e.target.value })}
                placeholder="gemini, google/" className={`${inputClass} font-mono`} />
              <span className="mt-1 block text-[#5A524A]">An agent node's model goes to the provider whose prefix matches it. Use * to serve every model no other provider serves.</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-[#EAE3D9]">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled
            </label>
          </div>
        </details>
        {testBanner(draft.id)}
        <div className="flex gap-2">
          <button type="button" onClick={() => edit(null)}
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

  const selectable = providers.filter((provider) => provider.enabled);

  return (
    <div className="space-y-4">
      {/* Default provider and model */}
      <section className="space-y-2 rounded-xl border border-[#9D4EDD]/30 bg-[#1A1614] p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9D4EDD]">
          <Sparkles className="h-3.5 w-3.5" /> Default model
        </div>
        <p className="text-[10px] text-[#A89F91]">Used by Insight, APL authoring and as the model of new agent nodes.</p>
        {selectable.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-[#E76F51]/30 bg-[#E76F51]/10 px-3 py-2.5 text-xs text-[#E76F51]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No AI provider yet. Add one below; agent nodes cannot run until a provider has a key.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <select value={defaultId} aria-label="Default provider"
                onChange={(e) => { setDefaultId(e.target.value); setDefaultModel(byId(e.target.value)?.defaultModel ?? ''); }}
                className="rounded-lg border border-[#3A322E] bg-[#14110D] px-2.5 py-2 text-xs text-[#EAE3D9]">
                {!chosenForDefault && <option value="">Choose a provider</option>}
                {selectable.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.displayName}{provider.configured ? '' : ' (no key)'}
                  </option>
                ))}
              </select>
              <input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} list="ai-default-models"
                aria-label="Default model" placeholder="model id"
                className="rounded-lg border border-[#3A322E] bg-[#14110D] px-2.5 py-2 font-mono text-xs text-[#EAE3D9]" />
              <datalist id="ai-default-models">
                {chosenForDefault && modelsFor(chosenForDefault.modelPatterns, chosenForDefault.defaultModel, agentModelOptions())
                  .map((model) => <option key={model} value={model} />)}
              </datalist>
              <button type="button" onClick={() => void saveDefault()} disabled={!defaultChanged || savingDefault}
                className="flex items-center gap-1.5 rounded-lg border border-[#2A9D8F]/50 bg-[#2A9D8F]/15 px-3 py-2 text-xs font-medium text-[#2A9D8F] disabled:opacity-40">
                {savingDefault ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Save
              </button>
            </div>
            {status?.insightFallback && requested && effective ? (
              <p className="flex items-start gap-1.5 text-[11px] text-[#F4A261]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {requested.displayName} has no usable key, so {effective.displayName} · {status.insightModel} is used meanwhile. Add a key to {requested.displayName} below.
              </p>
            ) : effective ? (
              <p className="text-[11px] text-[#A89F91]">
                In use: <span className="text-[#EAE3D9]">{effective.displayName} · <span className="font-mono">{status?.insightModel}</span></span>
                {keyStatusOf(effective) === 'environment' ? ' (key from server)' : ''}
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-[11px] text-[#E76F51]">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> No provider has a key yet, so Insight and agent nodes cannot run.
              </p>
            )}
          </>
        )}
      </section>

      {/* Providers */}
      <section className="space-y-2">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-[#A89F91]">Providers</h3>
        {providers.map((provider) => (
          <div key={provider.id} className={`rounded-lg border bg-[#14110D] px-3 py-2.5 ${provider.enabled ? 'border-[#3A322E]' : 'border-[#3A322E] opacity-70'}`}>
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-medium text-[#EAE3D9]">{provider.displayName}</span>
              {effective?.id === provider.id && (
                <span className="rounded-full border border-[#9D4EDD]/40 bg-[#9D4EDD]/10 px-2 py-0.5 text-[10px] text-[#9D4EDD]">Default</span>
              )}
              <KeyChip provider={provider} />
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => void test(provider.id)} disabled={testing !== null || !provider.configured} title="Test connection" aria-label={`Test ${provider.displayName}`}
                  className="rounded-md p-1.5 text-[#A89F91] hover:bg-[#2F2926] hover:text-[#EAE3D9] disabled:opacity-40">
                  {testing === provider.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={() => edit(draftFrom(provider))} title="Edit" aria-label={`Edit ${provider.displayName}`}
                  className="rounded-md p-1.5 text-[#A89F91] hover:bg-[#2F2926] hover:text-[#EAE3D9]"><Pencil className="h-3.5 w-3.5" /></button>
                {provider.saved && (
                  <button type="button" onClick={() => { setTestResult(null); setConfirmRemove(provider.id); }} title="Remove" aria-label={`Remove ${provider.displayName}`}
                    className="rounded-md p-1.5 text-[#A89F91] hover:bg-[#2F2926] hover:text-[#E76F51]"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
            </div>
            <p className="mt-1 text-[10px] text-[#A89F91]">
              Serves {describeRouting(provider.modelPatterns)}
              {provider.defaultModel ? <> · default <span className="font-mono text-[#C9BFAF]">{provider.defaultModel}</span></> : null}
            </p>
            {provider.providerType === 'openai-compatible' && provider.baseUrl && (
              <p className="mt-0.5 truncate font-mono text-[10px] text-[#5A524A]" title={provider.baseUrl}>{provider.baseUrl}</p>
            )}
            {testBanner(provider.id)}
            {confirmRemove === provider.id && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-[#E76F51]/30 bg-[#E76F51]/10 px-3 py-2 text-xs text-[#E76F51]">
                <span className="min-w-0 flex-1">
                  Remove {provider.displayName} from Studio?{provider.environmentConfigured ? ' The server key keeps it available with default settings.' : ''}
                </span>
                <button type="button" onClick={() => setConfirmRemove(null)}
                  className="rounded-md border border-[#3A322E] px-2 py-1 text-[11px] text-[#A89F91] hover:text-[#EAE3D9]">Cancel</button>
                <button type="button" onClick={() => void remove(provider)}
                  className="rounded-md border border-[#E76F51]/50 bg-[#E76F51]/15 px-2 py-1 text-[11px] font-medium text-[#E76F51]">Remove</button>
              </div>
            )}
          </div>
        ))}

        <div className="flex gap-2">
          <select value={addType} onChange={(e) => setAddType(e.target.value)} aria-label="Provider to add"
            className="flex-1 rounded-lg border border-[#3A322E] bg-[#14110D] px-2.5 py-2 text-xs text-[#EAE3D9]">
            {AI_PROVIDER_PRESETS.map((preset) => <option key={preset.type} value={preset.type}>{preset.label}</option>)}
          </select>
          <button type="button"
            onClick={() => edit(draftForPreset(addType, providers.map((provider) => provider.id)))}
            className="flex items-center gap-1.5 rounded-lg border border-[#2A9D8F]/50 bg-[#2A9D8F]/15 px-3 py-2 text-xs font-medium text-[#2A9D8F]">
            <Plus className="h-3.5 w-3.5" /> Add provider
          </button>
        </div>
      </section>

      <p className="text-[10px] leading-relaxed text-[#5A524A]">
        Keys are stored encrypted and never shown again. A key saved here overrides the server's <code className="text-[#A89F91]">ABADA_LLM_*</code> environment key for the same provider.
      </p>
    </div>
  );
};
