import React, { useEffect, useState, useCallback } from 'react';
import { X, Settings, Server, Key, Cpu, Globe, CheckCircle2, XCircle, AlertCircle, ShieldCheck, Plug, DollarSign } from 'lucide-react';
import { InsightAPI, InsightLlmConfig, InsightApprovalPolicy } from '@/api/insight';
import { AiProvidersSettings } from '@/components/settings/AiProvidersSettings';
import { ModelPricesSettings } from '@/components/settings/ModelPricesSettings';
import { presetFor } from '@/lib/aiProviders';
import { useAiProvidersVersion } from '@/lib/aiProviderEvents';
import { MotionBackdrop, MotionPanel } from '@/components/ui';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  definitionKey: string;
  projectId?: string;
}

type Tab = 'ai' | 'prices' | 'insight' | 'governance';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose, definitionKey, projectId }) => {
  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const [config, setConfig] = useState<InsightLlmConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<InsightApprovalPolicy | null>(null);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [llmConfig, approvalPolicy] = await Promise.all([
        InsightAPI.getLlmConfig(),
        InsightAPI.getPolicy(definitionKey, projectId).catch(() => null),
      ]);
      setConfig(llmConfig);
      setPolicy(approvalPolicy);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
    } finally {
      setIsLoading(false);
    }
  }, [definitionKey, projectId]);

  // The Insight tab shows the provider chosen in the AI Providers tab: read it
  // again when that tab saves something and whenever the Insight tab is opened.
  const aiProvidersVersion = useAiProvidersVersion();
  useEffect(() => {
    if (isOpen && activeTab === 'insight') void loadConfig();
  }, [isOpen, activeTab, aiProvidersVersion, loadConfig]);

  useEffect(() => {
    if (!isOpen) return;
    loadConfig();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, loadConfig]);

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
    <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-charcoal border border-hairline">
      <div className="flex items-center gap-2 text-xs text-sand">
        {icon && React.createElement(icon, { className: 'w-3.5 h-3.5' })}
        <span>{label}</span>
      </div>
      <span className="text-xs font-mono text-linen truncate max-w-[200px]">{value}</span>
    </div>
  );

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'ai', label: 'AI Providers', icon: Plug },
    { id: 'prices', label: 'Model Prices', icon: DollarSign },
    { id: 'insight', label: 'Insight Engine', icon: Cpu },
    { id: 'governance', label: 'Governance', icon: ShieldCheck },
  ];

  return (
    <MotionBackdrop
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal-deep/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <MotionPanel
        className="w-full max-w-xl rounded-2xl border border-hairline bg-charcoal shadow-warm-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-mineral-teal/15 border border-mineral-teal/40 flex items-center justify-center">
              <Settings className="w-4 h-4 text-mineral-teal" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-linen tracking-wide">Settings</h2>
              <p className="text-[10px] text-sand">Integrations &amp; AI</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-hairline bg-charcoal text-sand hover:text-linen hover:bg-mocha-hover transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-hairline px-5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-mineral-teal text-mineral-teal'
                  : 'border-transparent text-sand hover:text-linen'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {isLoading && activeTab !== 'ai' && (
            <div className="flex items-center gap-2 text-xs text-sand py-3">
              <div className="w-3.5 h-3.5 border-2 border-mineral-teal border-t-transparent rounded-full animate-spin" />
              Loading configuration...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-xs text-desert-rose bg-desert-rose/10 border border-desert-rose/30 rounded-lg py-2.5 px-3">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* AI Providers Tab */}
          {activeTab === 'ai' && <AiProvidersSettings onError={setError} />}
          {activeTab === 'prices' && <ModelPricesSettings onError={setError} />}

          {/* Insight Engine Tab */}
          {activeTab === 'insight' && !isLoading && config && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-wider text-sand font-medium">Insight Engine</h3>
                <div className="flex items-center gap-2 py-2.5 px-3 rounded-lg bg-charcoal border border-hairline">
                  <span className="text-xs text-sand">Status</span>
                  <span className="ml-auto flex items-center gap-1.5 text-xs font-medium">
                    {config.enabled ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-sage-green" />
                        <span className="text-sage-green">Enabled</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5 text-sand" />
                        <span className="text-sand">Disabled</span>
                      </>
                    )}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-wider text-sand font-medium">LLM Provider</h3>
                {configRow('Provider', config.providerId ? `${presetFor(config.providerType).label} (${config.source === 'STUDIO' ? 'key saved in Studio' : 'key from server'})` : 'Not configured', Server)}
                {configRow('Base URL', config.baseUrl || 'Not configured', Globe)}
                {configRow('Model', config.model || 'Not configured', Cpu)}
                <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-charcoal border border-hairline">
                  <div className="flex items-center gap-2 text-xs text-sand">
                    <Key className="w-3.5 h-3.5" />
                    <span>API Key</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    {config.configured ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-sage-green" />
                        <span className="text-sage-green">Configured</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5 text-desert-rose" />
                        <span className="text-desert-rose">Not set</span>
                      </>
                    )}
                  </span>
                </div>
              </div>

              {config.openRouterEnabled && config.providerType === 'openrouter' && (
                <div className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-wider text-sand font-medium">OpenRouter Headers</h3>
                  {configRow('HTTP-Referer', config.openRouterReferer, Globe)}
                  {configRow('X-Title', config.openRouterTitle, Server)}
                </div>
              )}

              <div className="text-[10px] text-sand bg-mocha rounded-lg p-3 space-y-1.5">
                <p className="font-medium text-linen">Where this comes from</p>
                <p>Insight uses the <strong>Default model</strong> chosen in the AI Providers tab, with the same keys as agent tasks. Change it there.</p>
              </div>
            </div>
          )}

          {/* Governance Tab */}
          {activeTab === 'governance' && !isLoading && policy && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-wider text-sand font-medium">
                  Governance — {policy.definitionKey}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-sand">Required approvals
                    <input type="number" min={1} max={20} value={policy.requiredApprovals}
                      onChange={(e) => setPolicy({ ...policy, requiredApprovals: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-hairline bg-charcoal-deep px-2.5 py-2 text-xs text-linen" />
                  </label>
                  <label className="text-[10px] text-sand">Approval mode
                    <select value={policy.approvalMode}
                      onChange={(e) => setPolicy({ ...policy,
                        approvalMode: e.target.value as InsightApprovalPolicy['approvalMode'] })}
                      className="mt-1 w-full rounded-lg border border-hairline bg-charcoal-deep px-2.5 py-2 text-xs text-linen">
                      <option value="PARALLEL">Parallel</option>
                      <option value="SEQUENTIAL">Sequential</option>
                    </select>
                  </label>
                </div>
                <label className="block text-[10px] text-sand">Reviewer groups (comma-separated)
                  <input value={policy.requiredGroups}
                    onChange={(e) => setPolicy({ ...policy, requiredGroups: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-hairline bg-charcoal-deep px-2.5 py-2 text-xs font-mono text-linen" />
                </label>
                <button type="button" onClick={savePolicy} disabled={isSavingPolicy}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-mineral-teal/50 bg-mineral-teal/15 py-2 text-xs font-medium text-mineral-teal disabled:opacity-50">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {isSavingPolicy ? 'Saving...' : `Save policy v${policy.policyVersion}`}
                </button>
                <p className="text-[10px] text-sand">New proposals snapshot this policy. Existing reviews are unchanged.</p>
              </div>
            </div>
          )}

          {/* Empty state for governance tab when no policy */}
          {activeTab === 'governance' && !isLoading && !policy && (
            <div className="text-xs text-sand py-6 text-center">
              No governance policy configured for this definition.
            </div>
          )}
        </div>
      </MotionPanel>
    </MotionBackdrop>
  );
};
