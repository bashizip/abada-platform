import React, { useEffect, useState } from 'react';
import { X, Settings, Server, Key, Cpu, Globe, CheckCircle2, XCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import { InsightAPI, InsightLlmConfig, InsightApprovalPolicy } from '@/api/insight';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  definitionKey: string;
  projectId?: string;
}

/**
 * Settings panel for Abada Studio configuration.
 * Currently displays LLM provider settings for the Insight Engine.
 * Settings are read-only in the UI; actual configuration is via environment
 * variables (ABADA_LLM_*) and Spring properties.
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose, definitionKey, projectId }) => {
  const [config, setConfig] = useState<InsightLlmConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<InsightApprovalPolicy | null>(null);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [data, approvalPolicy] = await Promise.all([
          InsightAPI.getLlmConfig(), InsightAPI.getPolicy(definitionKey, projectId),
        ]);
        setConfig(data);
        setPolicy(approvalPolicy);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load configuration');
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, definitionKey, projectId]);

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
              <p className="text-[10px] text-[#A89F91]">Insight Engine Configuration</p>
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

        {/* Content */}
        <div className="px-5 py-4 space-y-4">
          {/* Status Banner */}
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

          {config && (
            <>
              {/* Insight Engine Status */}
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

              {/* LLM Provider Configuration */}
              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-wider text-[#A89F91] font-medium">LLM Provider</h3>

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

              {policy && (
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
                    {isSavingPolicy ? 'Saving…' : `Save policy v${policy.policyVersion}`}
                  </button>
                  <p className="text-[10px] text-[#A89F91]">New proposals snapshot this policy. Existing reviews are unchanged.</p>
                </div>
              )}

              {/* OpenRouter Configuration */}
              {config.openRouterEnabled && (
                <div className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-wider text-[#A89F91] font-medium">OpenRouter Headers</h3>
                  {configRow('HTTP-Referer', config.openRouterReferer, Globe)}
                  {configRow('X-Title', config.openRouterTitle, Server)}
                </div>
              )}

              {/* Configuration Instructions */}
              <div className="text-[10px] text-[#A89F91] bg-[#25201D] rounded-lg p-3 space-y-1.5">
                <p className="font-medium text-[#EAE3D9]">Configuration via Environment Variables</p>
                <p>Set these environment variables to configure the LLM provider:</p>
                <ul className="space-y-0.5 font-mono text-[#2A9D8F]">
                  <li>ABADA_LLM_BASE_URL</li>
                  <li>ABADA_LLM_API_KEY</li>
                  <li>ABADA_LLM_MODEL</li>
                </ul>
                <p className="text-[#A89F91] pt-1">
                  Example: <code className="text-[#F4A261]">ABADA_LLM_BASE_URL=https://openrouter.ai/api/v1</code>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
