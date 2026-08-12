import React, { useState } from 'react';
import { WorkflowNode, NodeType, AgentConfig, HumanConfig } from '@/types';
import { DmnRuleInspector } from '@/features/dmn/DmnRuleInspector';
import { AGENT_MODEL_OPTIONS, DEFAULT_AGENT_MODEL } from '@/lib/agentModels';
import { 
  Bot, 
  UserCheck, 
  Table, 
  GitFork, 
  GitMerge,
  Circle, 
  SlidersHorizontal, 
  Play, 
  Plus, 
  Trash2, 
  ShieldAlert, 
  Sparkles, 
  CheckCircle2, 
  Clock, 
  Zap, 
  Sliders, 
  Info,
  Terminal
} from 'lucide-react';

interface PropertiesInspectorProps {
  selectedNode: WorkflowNode | null;
  onUpdateNode: (updatedNode: WorkflowNode) => void;
  onRunAgentTest: (agentConfig: AgentConfig, testInput: string) => Promise<any>;
  nodeCount: number;
}

export const PropertiesInspector: React.FC<PropertiesInspectorProps> = ({
  selectedNode,
  onUpdateNode,
  onRunAgentTest,
  nodeCount,
}) => {
  const [testPayload, setTestPayload] = useState<string>(
    JSON.stringify({ orderId: 'ORD-9842', amountUSD: 14200, jurisdiction: 'EU', ipRiskScore: 78 }, null, 2)
  );
  const [testResult, setTestResult] = useState<any | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);

  if (!selectedNode) {
    return (
      <aside className="w-80 bg-[#25201D] border-l border-[#3A322E] flex flex-col h-full z-10 shrink-0 p-4 space-y-5 overflow-y-auto">
        <div className="flex items-center space-x-2 text-[#F4A261]">
          <Sliders className="w-4 h-4" />
          <h2 className="font-bold text-sm text-[#EAE3D9] tracking-wide">Properties Inspector</h2>
        </div>

        <div className="p-4 bg-[#1A1614] rounded-2xl border border-[#3A322E] text-center space-y-2">
          <Info className="w-6 h-6 text-[#A89F91] mx-auto" />
          <p className="text-xs text-[#EAE3D9] font-medium">No Node Selected</p>
          <p className="text-[11px] text-[#A89F91] leading-relaxed">
            Click any node on the BPMN canvas to inspect and modify AI agent prompts, confidence thresholds, or DMN decision rules.
          </p>
        </div>

        {/* Workflow Summary Card */}
        <div className="space-y-3">
          <span className="text-[11px] font-semibold tracking-wider text-[#A89F91] uppercase block">
            Process Architecture Stats
          </span>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 bg-[#1A1614] rounded-xl border border-[#3A322E]">
              <span className="text-[10px] text-[#A89F91] block">Total Nodes</span>
              <span className="text-lg font-bold text-[#EAE3D9]">{nodeCount}</span>
            </div>
            <div className="p-3 bg-[#1A1614] rounded-xl border border-[#9D4EDD]/30 glow-amethyst-subtle">
              <span className="text-[10px] text-[#9D4EDD] block">AI Agents</span>
              <span className="text-lg font-bold text-[#9D4EDD]">Active</span>
            </div>
            <div className="p-3 bg-[#1A1614] rounded-xl border border-[#2A9D8F]/30">
              <span className="text-[10px] text-[#2A9D8F] block">DMN Rules</span>
              <span className="text-lg font-bold text-[#2A9D8F]">Bound</span>
            </div>
            <div className="p-3 bg-[#1A1614] rounded-xl border border-[#E76F51]/30">
              <span className="text-[10px] text-[#E76F51] block">Human SLAs</span>
              <span className="text-lg font-bold text-[#E76F51]">Active</span>
            </div>
          </div>
        </div>

        {/* Global Process Rules */}
        <div className="p-3.5 bg-[#1A1614] rounded-xl border border-[#3A322E] space-y-2.5 text-xs">
          <span className="font-semibold text-[#EAE3D9] block">Execution Policy</span>
          <div className="flex justify-between text-[#A89F91]">
            <span>Orchestration Mode</span>
            <span className="text-[#F4A261] font-mono">Serverless</span>
          </div>
          <div className="flex justify-between text-[#A89F91]">
            <span>Model Engine</span>
            <span className="text-[#9D4EDD] font-mono">{DEFAULT_AGENT_MODEL}</span>
          </div>
          <div className="flex justify-between text-[#A89F91]">
            <span>Default Fallback</span>
            <span className="text-[#E76F51]">Escalate to Human</span>
          </div>
        </div>
      </aside>
    );
  }

  // Handle updates to general node properties
  const handleGeneralChange = (field: keyof WorkflowNode, value: any) => {
    onUpdateNode({
      ...selectedNode,
      [field]: value,
    });
  };

  // Handle agent config updates
  const handleAgentChange = (field: keyof AgentConfig, value: any) => {
    if (!selectedNode.agentConfig) return;
    onUpdateNode({
      ...selectedNode,
      agentConfig: {
        ...selectedNode.agentConfig,
        [field]: value,
      },
    });
  };

  // Numeric agent settings round-trip into the node APL; an empty field is
  // written back as undefined so the YAML omits the key (engine default wins).
  const handleAgentNumber = (field: 'maxTokens' | 'maxAttempts', raw: string) => {
    if (raw.trim() === '') {
      handleAgentChange(field, undefined);
      return;
    }
    const parsed = Number(raw);
    handleAgentChange(field, Number.isFinite(parsed) ? parsed : undefined);
  };

  // Handle human task updates
  const handleHumanChange = (field: keyof HumanConfig, value: any) => {
    if (!selectedNode.humanConfig) return;
    onUpdateNode({
      ...selectedNode,
      humanConfig: {
        ...selectedNode.humanConfig,
        [field]: value,
      },
    });
  };

  // Model selector options stay in sync with the node's APL: the curated list
  // is always joined by the current model when it is not among the options, so
  // the dropdown can never render an empty/ghost selection.
  const agentConfig = selectedNode.agentConfig;
  const currentModel = agentConfig?.model || DEFAULT_AGENT_MODEL;
  const modelOptions = AGENT_MODEL_OPTIONS.includes(currentModel)
    ? AGENT_MODEL_OPTIONS
    : [currentModel, ...AGENT_MODEL_OPTIONS];

  // Run live test for AI agent
  const executeAgentTest = async () => {
    if (!selectedNode.agentConfig) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await onRunAgentTest(selectedNode.agentConfig, testPayload);
      setTestResult(res);
    } catch (e: any) {
      setTestResult({ error: e.message || 'Test failed' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <aside className="w-80 bg-[#25201D] border-l border-[#3A322E] flex flex-col h-full z-10 shrink-0 overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-[#3A322E] bg-[#1A1614]/60 sticky top-0 z-10 backdrop-blur-md flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {selectedNode.type === 'agent' && <Bot className="w-4 h-4 text-[#9D4EDD]" />}
          {selectedNode.type === 'human' && <UserCheck className="w-4 h-4 text-[#E76F51]" />}
          {selectedNode.type === 'dmn' && <Table className="w-4 h-4 text-[#2A9D8F]" />}
          {selectedNode.type === 'engine-task' && <Zap className="w-4 h-4 text-[#90A955]" />}
          {selectedNode.type === 'gateway' && (selectedNode.subtype === 'parallel'
            ? <GitMerge className="w-4 h-4 text-[#F4A261]" />
            : <GitFork className="w-4 h-4 text-[#F4A261]" />)}
          {selectedNode.type === 'event' && <Circle className="w-4 h-4 text-[#F4A261]" />}
          <h2 className="font-bold text-sm text-[#EAE3D9] tracking-wide capitalize">
            {selectedNode.type} Node Settings
          </h2>
        </div>
        <span className="text-[10px] font-mono text-[#A89F91] bg-[#1A1614] px-2 py-0.5 rounded border border-[#3A322E]">
          {selectedNode.id}
        </span>
      </div>

      <div className="p-4 space-y-6">
        {/* General Details */}
        <div className="space-y-3">
          <span className="text-[11px] font-semibold tracking-wider text-[#A89F91] uppercase block">
            General Properties
          </span>

          <div className="space-y-1.5">
            <label className="text-xs text-[#A89F91] block">Node Title</label>
            <input
              type="text"
              value={selectedNode.title}
              onChange={(e) => handleGeneralChange('title', e.target.value)}
              className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#F4A261]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-[#A89F91] block">Description</label>
            <textarea
              rows={2}
              value={selectedNode.description}
              onChange={(e) => handleGeneralChange('description', e.target.value)}
              className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl p-3 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#F4A261] resize-none"
            />
          </div>
        </div>

        {/* AI Agent Configuration Panel */}
        {selectedNode.type === 'agent' && selectedNode.agentConfig && (
          <div className="space-y-4 pt-4 border-t border-[#3A322E]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider text-[#9D4EDD] uppercase flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                AI Agent Configuration
              </span>
              <span className="max-w-[50%] truncate text-[10px] bg-[#9D4EDD]/20 text-[#9D4EDD] px-2 py-0.5 rounded-full font-mono" title={currentModel}>
                {currentModel}
              </span>
            </div>

            {/* Model Selection */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">LLM Engine Model</label>
              <select
                value={currentModel}
                onChange={(e) => handleAgentChange('model', e.target.value)}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#9D4EDD]"
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}{model === DEFAULT_AGENT_MODEL ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-[#A89F91] leading-relaxed">
                Mirrored into the node's APL (<span className="font-mono text-[#9D4EDD]">model:</span>). Any model id already in the YAML stays selected and is listed first.
              </p>
            </div>

            {/* System Prompt */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">System Directive / Prompt</label>
              <textarea
                rows={4}
                value={selectedNode.agentConfig.systemPrompt}
                onChange={(e) => handleAgentChange('systemPrompt', e.target.value)}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl p-3 text-xs text-[#EAE3D9] font-mono focus:outline-none focus:border-[#9D4EDD] leading-relaxed"
              />
            </div>

            {/* Confidence Slider */}
            <div className="space-y-2 p-3 bg-[#1A1614] rounded-xl border border-[#9D4EDD]/30 glow-amethyst-subtle">
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#EAE3D9] font-medium flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-[#9D4EDD]" />
                  Confidence Threshold
                </span>
                <span className="font-mono font-bold text-[#9D4EDD]">
                  {selectedNode.agentConfig.confidenceThreshold}%
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="99"
                value={selectedNode.agentConfig.confidenceThreshold}
                onChange={(e) => handleAgentChange('confidenceThreshold', Number(e.target.value))}
                className="w-full accent-[#9D4EDD] bg-[#25201D] h-1.5 rounded-lg cursor-pointer"
              />
              <p className="text-[10px] text-[#A89F91] leading-relaxed">
                If AI execution confidence falls below <strong className="text-[#9D4EDD]">{selectedNode.agentConfig.confidenceThreshold}%</strong>, execution automatically triggers escalation to human review.
              </p>
            </div>

            {/* Temperature Slider */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs text-[#A89F91]">
                <span>Temperature (Determinism)</span>
                <span className="font-mono text-[#EAE3D9]">{selectedNode.agentConfig.temperature}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={selectedNode.agentConfig.temperature}
                onChange={(e) => handleAgentChange('temperature', Number(e.target.value))}
                className="w-full accent-[#F4A261] bg-[#1A1614] h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            {/* Max Tokens & Max Attempts — mirrored into max_tokens / max_attempts */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-[#A89F91] block">Max Tokens</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="engine default"
                  value={selectedNode.agentConfig.maxTokens ?? ''}
                  onChange={(e) => handleAgentNumber('maxTokens', e.target.value)}
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#9D4EDD]"
                />
                <p className="text-[10px] text-[#A89F91] leading-relaxed">
                  APL <span className="font-mono text-[#9D4EDD]">max_tokens:</span> — empty leaves the engine default.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[#A89F91] block">Max Attempts</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  placeholder="engine default"
                  value={selectedNode.agentConfig.maxAttempts ?? ''}
                  onChange={(e) => handleAgentNumber('maxAttempts', e.target.value)}
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#9D4EDD]"
                />
                <p className="text-[10px] text-[#A89F91] leading-relaxed">
                  APL <span className="font-mono text-[#9D4EDD]">max_attempts:</span> durable retries before the job fails.
                </p>
              </div>
            </div>

            {/* Tools Checklist */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Bound Tool APIs</label>
              <div className="rounded-lg border border-[#3A322E] divide-y divide-[#3A322E] bg-[#1A1614] overflow-hidden">
                {['Database Query', 'Vision OCR Engine', 'ERP Connector', 'Stripe Charge Logs', 'Sanctions Database'].map((tool) => {
                  const isBound = selectedNode.agentConfig?.tools.includes(tool);
                  return (
                    <label key={tool} className="group flex items-center gap-2 text-xs text-[#EAE3D9] cursor-pointer px-2 py-1.5 hover:bg-[#25201D] transition-colors">
                      <input
                        type="checkbox"
                        checked={isBound}
                        onChange={(e) => {
                          const currentTools = selectedNode.agentConfig?.tools || [];
                          const updated = e.target.checked
                            ? [...currentTools, tool]
                            : currentTools.filter((t) => t !== tool);
                          handleAgentChange('tools', updated);
                        }}
                        className="accent-[#9D4EDD] rounded"
                      />
                      <span>{tool}</span>
                      <span className="ml-auto text-[10px] font-mono text-[#A89F91] opacity-0 group-hover:opacity-100 transition-opacity">
                        {isBound ? 'bound' : 'available'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Live Test Drawer */}
            <div className="pt-3 border-t border-[#3A322E] space-y-2">
              <span className="text-xs font-semibold text-[#EAE3D9] block">Interactive Prompt Test</span>
              <textarea
                rows={3}
                value={testPayload}
                onChange={(e) => setTestPayload(e.target.value)}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl p-2.5 text-[11px] font-mono text-[#EAE3D9] focus:outline-none focus:border-[#9D4EDD]"
                placeholder="JSON payload..."
              />
              <button
                onClick={executeAgentTest}
                disabled={isTesting}
                className="w-full py-2 bg-[#9D4EDD] hover:bg-[#8b32d4] text-white font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-2 glow-amethyst-subtle"
              >
                {isTesting ? (
                  <>
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing Gemini API...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Test Agent Logic</span>
                  </>
                )}
              </button>

              {testResult && (
                <div className="p-3 bg-[#1A1614] rounded-xl border border-[#9D4EDD]/40 text-xs space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-[#9D4EDD] flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#90A955]" />
                      Confidence: {testResult.calculatedConfidence}%
                    </span>
                    <span className="text-[10px] text-[#A89F91]">
                      {testResult.executionTimeMs}ms
                    </span>
                  </div>

                  {testResult.reasoningSteps && (
                    <div className="space-y-1 border-t border-[#3A322E] pt-2">
                      <span className="text-[10px] text-[#A89F91] block uppercase font-mono">Reasoning Steps:</span>
                      {testResult.reasoningSteps.map((step: string, i: number) => (
                        <p key={i} className="text-[11px] text-[#EAE3D9] leading-tight">
                          {step}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* DMN Decision Table Configuration (native decision-table block) */}
        {selectedNode.type === 'dmn' && selectedNode.dmnConfig && (
          <DmnRuleInspector node={selectedNode} onUpdateNode={onUpdateNode} />
        )}

        {/* Engine Task Configuration (external service topic) */}
        {selectedNode.type === 'engine-task' && (
          <div className="space-y-4 pt-4 border-t border-[#3A322E]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider text-[#90A955] uppercase flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" />
                Engine Task Configuration
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">External Service Topic</label>
              <input
                type="text"
                value={selectedNode.engineTaskConfig?.service || ''}
                onChange={(e) => onUpdateNode({
                  ...selectedNode,
                  engineTaskConfig: {
                    ...(selectedNode.engineTaskConfig || {}),
                    service: e.target.value,
                  },
                })}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] font-mono focus:outline-none focus:border-[#90A955]"
              />
              <p className="text-[10px] text-[#A89F91] leading-relaxed">
                Workers subscribe to this topic to fetch the durable job (e.g. <span className="font-mono text-[#90A955]">abada:credit-check</span>).
              </p>
            </div>
          </div>
        )}

        {/* Gateway Configuration */}
        {selectedNode.type === 'gateway' && (
          <div className="space-y-4 pt-4 border-t border-[#3A322E]">
            <span className="text-[11px] font-semibold tracking-wider text-[#F4A261] uppercase block">
              Gateway Configuration
            </span>

            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Gateway Kind</label>
              <select
                value={selectedNode.subtype || 'exclusive'}
                onChange={(e) => handleGeneralChange('subtype', e.target.value)}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#F4A261]"
              >
                <option value="exclusive">Exclusive — one matching branch (&gt;1 outgoing edge routes via conditions)</option>
                <option value="parallel">Parallel — unconditional fork / join</option>
              </select>
              <p className="text-[10px] text-[#A89F91] leading-relaxed">
                {selectedNode.subtype === 'parallel'
                  ? 'Fork: connect each outgoing edge; the engine runs every branch concurrently. Join: upstream nodes converge back here and it continues along its single outgoing edge.'
                  : 'Conditional flows evaluate in order; the last flow becomes the default branch.'}
              </p>
            </div>
          </div>
        )}

        {/* Human Task Configuration */}
        {selectedNode.type === 'human' && selectedNode.humanConfig && (
          <div className="space-y-4 pt-4 border-t border-[#3A322E]">
            <span className="text-[11px] font-semibold tracking-wider text-[#E76F51] uppercase block">
              Human Escalation Review
            </span>

            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Assignee Role</label>
              <input
                type="text"
                value={selectedNode.humanConfig.assigneeRole}
                onChange={(e) => handleHumanChange('assigneeRole', e.target.value)}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#E76F51]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">SLA Timer (Hours)</label>
              <input
                type="number"
                value={selectedNode.humanConfig.slaHours}
                onChange={(e) => handleHumanChange('slaHours', Number(e.target.value))}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#E76F51]"
              />
            </div>

            <div className="p-3 bg-[#1A1614] rounded-xl border border-[#E76F51]/30 space-y-2">
              <label className="flex items-center justify-between text-xs text-[#EAE3D9] cursor-pointer">
                <span>Require Dual Manager Sign-off</span>
                <input
                  type="checkbox"
                  checked={selectedNode.humanConfig.requireDoubleSignOff || false}
                  onChange={(e) => handleHumanChange('requireDoubleSignOff', e.target.checked)}
                  className="accent-[#E76F51] rounded"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
