import React, { useEffect, useState, useCallback } from 'react';
import { X, Settings, Server, Key, Cpu, Globe, CheckCircle2, XCircle, AlertCircle, ShieldCheck, Plug, Loader2 } from 'lucide-react';
import { InsightAPI, InsightLlmConfig, InsightApprovalPolicy, AiProviderSettings, SaveAiProviderRequest, LlmConnectionTestResult } from '@/api/insight';
import { setCachedModel } from '@/lib/agentModels';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  definitionKey: string;
  projectId?: string;
}

type Tab = 'ai' | 'insight' | 'governance';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'] as const;

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose, definitionKey, projectId }) => {
  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const [config, setConfig] = useState<InsightLlmConfig | null>(null);
  const [aiSettings, setAiSettings] = useState<AiProviderSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<InsightApprovalPolicy | null>(null);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  // AI Provider form state
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>(GEMINI_MODELS[0]);
  const [isSavingAi, setIsSavingAi] = useState(false);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [testResult, setTestResult] = useState<LlmConnectionTestResult | null>(null);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [llmConfig, aiData, approvalPolicy] = await Promise.all([
        InsightAPI.getLlmConfig(),
        InsightAPI.getAiSettings().catch(() => null),
        InsightAPI.getPolicy(definitionKey, projectId).catch(() => null),
      ]);
      setConfig(llmConfig);
      setAiSettings(aiData);
      setPolicy(approvalPolicy);

      if (aiData) {
        setModel(aiData.model || GEMINI_MODELS[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
    } finally {
      setIsLoading(false);
    }
  }, [definitionKey, projectId]);

  useEffect(() => {
    if (!isOpen) return;
    loadConfig();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, loadConfig]);

  const saveAiSettings = async () => {
    setIsSavingAi(true);
    setError(null);
    setTestResult(null);
    try {
      const request: SaveAiProviderRequest = {
        providerType: 'gemini',
        baseUrl: GEMINI_BASE_URL,
        model,
        enabled: true,
      };
      if (apiKey.trim()) {
        request.apiKey = apiKey.trim();
      }
      const result = await InsightAPI.saveAiSettings(request);
      setAiSettings(result);
      setCachedModel(model);
      setApiKey('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save AI settings');
    } finally {
      setIsSavingAi(false);
    }
  };

  const testAiConnection = async () => {
    setIsTestingAi(true);
    setError(null);
    setTestResult(null);
    try {
      const overrides: Partial<SaveAiProviderRequest> = {
        providerType: 'gemini',
        baseUrl: GEMINI_BASE_URL,
        model,
      };
      if (apiKey.trim()) overrides.apiKey = apiKey.trim();
      const result = await InsightAPI.testAiConnection(overrides);
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setIsTestingAi(false);
    }
  };

  const savePolicy = async () => {
    if (!policy) return;
    setIsSavingPolicy(true);
    setError(null);
    try {
      setPolicy(await InsightAPI.updatePolicy(policy, projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save approval policy');
    } finally {
      setIsSavingPolicy(false);
    }
  };

  if (!isOpen) return null;

  const configRow = (label: string, value: React.ReactNode, icon?: React.ElementType) => (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-[#1A1614] border border-[#3A322E]">
      <div className="flex items-center gap-2 text-xs text-[#A89F91]">
        {icon && React.createElement(icon, { className: 'w-3.5 h-3.5' })}
        <span>{label}</span>
      </div>
      <span className="text-xs font-mono text-[#EAE3D9] truncate max-w-[200px]">{value}</span>
    </div>
  );

  const inputClass = "w-full rounded-lg border border-[#3A322E] bg-[#14110D] px-2.5 py-2 text-xs text-[#EAE3D9] placeholder-[#5A524A] focus:border-[#2A9D8F] focus:outline-none focus:ring-1 focus:ring-[#2A9D8F]/30";

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'ai', label: 'AI Providers', icon: Plug },
    { id: 'insight', label: 'Insight Engine', icon: Cpu },
    { id: 'governance', label: 'Governance', icon: ShieldCheck },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#14110D]/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[#3A322E] bg-[#1A1614] shadow-warm-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3A322E]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#2A9D8F]/15 border border-[#2A9D8F]/40 flex items-center justify-center">
              <Settings className="w-4 h-4 text-[#2A9D8F]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#EAE3D9] tracking-wide">Settings</h2>
              <p className="text-[10px] text-[#A89F91]">Integrations &amp; AI</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#3A322E] bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9] hover:bg-[#2F2926] transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#3A322E] px-5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-[#2A9D8F] text-[#2A9D8F]'
                  : 'border-transparent text-[#A89F91] hover:text-[#EAE3D9]'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-[#A89F91] py-3">
              <div className="w-3.5 h-3.5 border-2 border-[#2A9D8F] border-t-transparent rounded-full animate-spin" />
              Loading configuration...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-xs text-[#E76F51] bg-[#E76F51]/10 border border-[#E76F51]/30 rounded-lg py-2.5 px-3">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* AI Providers Tab */}
          {activeTab === 'ai' && !isLoading && (
            <div className="space-y-4">
              {/* Status Banner */}
              <div className="flex items-center gap-2 py-2.5 px-3 rounded-lg bg-[#1A1614] border border-[#3A322E]">
                <span className="text-xs text-[#A89F91]">Status</span>
                <span className="ml-auto flex items-center gap-1.5 text-xs font-medium">
                  {aiSettings?.configured ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#90A955]" />
                      <span className="text-[#90A955]">Connected</span>
                    </>
                  ) : aiSettings?.baseUrl ? (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-[#2A9D8F]" />
                      <span className="text-[#2A9D8F]">Configured</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-[#E76F51]" />
                      <span className="text-[#E76F51]">Not configured</span>
                    </>
                  )}
                </span>
              </div>

              {/* Gemini Config */}
              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-wider text-[#A89F91] font-medium">Google Gemini</h3>
                <label className="block text-[10px] text-[#A89F91]">
                  Model
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#3A322E] bg-[#14110D] px-2.5 py-2 text-xs text-[#EAE3D9]"
                  >
                    {GEMINI_MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-[10px] text-[#A89F91]">
                  API Key
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={aiSettings?.apiKeyHint || 'Enter Gemini API key'}
                    className={`mt-1 ${inputClass}`}
                  />
                  {aiSettings?.apiKeyHint && (
                    <span className="text-[10px] text-[#5A524A] mt-0.5 block">
                      Saved: {aiSettings.apiKeyHint}
                    </span>
                  )}
                </label>
              </div>

              {/* Test Result */}
              {testResult && (
                <div className={`flex items-start gap-2 text-xs py-2.5 px-3 rounded-lg border ${
                  testResult.success
                    ? 'text-[#90A955] bg-[#90A955]/10 border-[#90A955]/30'
                    : 'text-[#E76F51] bg-[#E76F51]/10 border-[#E76F51]/30'
                }`}>
                  {testResult.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p>{testResult.message}</p>
                    {testResult.latencyMs && (
                      <p className="text-[10px] opacity-70">{testResult.latencyMs}ms</p>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={testAiConnection}
                  disabled={isTestingAi}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-[#3A322E] bg-[#1A1614] py-2 text-xs font-medium text-[#A89F91] hover:text-[#EAE3D9] hover:bg-[#2F2926] disabled:opacity-50 transition-all"
                >
                  {isTestingAi ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plug className="w-3.5 h-3.5" />
                  )}
                  {isTestingAi ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  type="button"
                  onClick={saveAiSettings}
                  disabled={isSavingAi}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-[#2A9D8F]/50 bg-[#2A9D8F]/15 py-2 text-xs font-medium text-[#2A9D8F] disabled:opacity-50 transition-all"
                >
                  {isSavingAi ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  {isSavingAi ? 'Saving...' : 'Save Settings'}
                </button>
              </div>

              {/* Source info */}
              <div className="text-[10px] text-[#A89F91] bg-[#25201D] rounded-lg p-3 space-y-1">
                <p className="font-medium text-[#EAE3D9]">Key Resolution</p>
                <p>Workspace key (this panel) takes priority over environment variable <code className="text-[#F4A261]">ABADA_LLM_API_KEY</code>.</p>
              </div>
            </div>
          )}

          {/* Insight Engine Tab */}
          {activeTab === 'insight' && !isLoading && config && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-wider text-[#A89F91] font-medium">Insight Engine</h3>
                <div className="flex items-center gap-2 py-2.5 px-3 rounded-lg bg-[#1A1614] border border-[#3A322E]">
                  <span className="text-xs text-[#A89F91]">Status</span>
                  <span className="ml-auto flex items-center gap-1.5 text-xs font-medium">
                    {config.enabled ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#90A955]" />
                        <span className="text-[#90A955]">Enabled</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5 text-[#A89F91]" />
                        <span className="text-[#A89F91]">Disabled</span>
                      </>
                    )}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-wider text-[#A89F91] font-medium">LLM Provider (Environment)</h3>
                {configRow('Provider Type', config.providerType, Server)}
                {configRow('Base URL', config.baseUrl || 'Not configured', Globe)}
                {configRow('Model', config.model || 'Not configured', Cpu)}
                <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-[#1A1614] border border-[#3A322E]">
                  <div className="flex items-center gap-2 text-xs text-[#A89F91]">
                    <Key className="w-3.5 h-3.5" />
                    <span>API Key</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    {config.configured ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#90A955]" />
                        <span className="text-[#90A955]">Configured</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5 text-[#E76F51]" />
                        <span className="text-[#E76F51]">Not set</span>
                      </>
                    )}
                  </span>
                </div>
              </div>

              {config.openRouterEnabled && (
                <div className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-wider text-[#A89F91] font-medium">OpenRouter Headers</h3>
                  {configRow('HTTP-Referer', config.openRouterReferer, Globe)}
                  {configRow('X-Title', config.openRouterTitle, Server)}
                </div>
              )}

              <div className="text-[10px] text-[#A89F91] bg-[#25201D] rounded-lg p-3 space-y-1.5">
                <p className="font-medium text-[#EAE3D9]">Environment Variables</p>
                <ul className="space-y-0.5 font-mono text-[#2A9D8F]">
                  <li>ABADA_LLM_BASE_URL</li>
                  <li>ABADA_LLM_API_KEY</li>
                  <li>ABADA_LLM_MODEL</li>
                </ul>
              </div>
            </div>
          )}

          {/* Governance Tab */}
          {activeTab === 'governance' && !isLoading && policy && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-wider text-[#A89F91] font-medium">
                  Governance — {policy.definitionKey}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-[#A89F91]">Required approvals
                    <input type="number" min={1} max={20} value={policy.requiredApprovals}
                      onChange={(e) => setPolicy({ ...policy, requiredApprovals: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-[#3A322E] bg-[#14110D] px-2.5 py-2 text-xs text-[#EAE3D9]" />
                  </label>
                  <label className="text-[10px] text-[#A89F91]">Approval mode
                    <select value={policy.approvalMode}
                      onChange={(e) => setPolicy({ ...policy,
                        approvalMode: e.target.value as InsightApprovalPolicy['approvalMode'] })}
                      className="mt-1 w-full rounded-lg border border-[#3A322E] bg-[#14110D] px-2.5 py-2 text-xs text-[#EAE3D9]">
                      <option value="PARALLEL">Parallel</option>
                      <option value="SEQUENTIAL">Sequential</option>
                    </select>
                  </label>
                </div>
                <label className="block text-[10px] text-[#A89F91]">Reviewer groups (comma-separated)
                  <input value={policy.requiredGroups}
                    onChange={(e) => setPolicy({ ...policy, requiredGroups: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[#3A322E] bg-[#14110D] px-2.5 py-2 text-xs font-mono text-[#EAE3D9]" />
                </label>
                <button type="button" onClick={savePolicy} disabled={isSavingPolicy}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-[#2A9D8F]/50 bg-[#2A9D8F]/15 py-2 text-xs font-medium text-[#2A9D8F] disabled:opacity-50">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {isSavingPolicy ? 'Saving...' : `Save policy v${policy.policyVersion}`}
                </button>
                <p className="text-[10px] text-[#A89F91]">New proposals snapshot this policy. Existing reviews are unchanged.</p>
              </div>
            </div>
          )}

          {/* Empty state for governance tab when no policy */}
          {activeTab === 'governance' && !isLoading && !policy && (
            <div className="text-xs text-[#A89F91] py-6 text-center">
              No governance policy configured for this definition.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
