import React, { useState } from 'react';
import { WorkflowNode, NodeType, AgentConfig, DMNConfig, HumanConfig } from '@/types';
import { 
  Bot, 
  UserCheck, 
  Table, 
  GitFork, 
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
  // Draft text for each rule's THEN outputs so in-progress typing is never
  // clobbered by the parsed value (committed on blur).
  const [thenDrafts, setThenDrafts] = useState<Record<string, string>>({});

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
            <span className="text-[#9D4EDD] font-mono">Gemini 3.6 Flash</span>
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

  // Handle DMN config updates
  const handleDmnChange = (field: keyof DMNConfig, value: any) => {
    if (!selectedNode.dmnConfig) return;
    onUpdateNode({
      ...selectedNode,
      dmnConfig: {
        ...selectedNode.dmnConfig,
        [field]: value,
      },
    });
  };

  // Handle DMN rule table edits
  const handleAddDmnRule = () => {
    if (!selectedNode.dmnConfig) return;
    const newRule = {
      id: `r-${Date.now()}`,
      when: 'OrderAmountUSD > 5000',
      then: { TaxRate: '12%' },
      description: 'New custom policy condition',
    };
    onUpdateNode({
      ...selectedNode,
      dmnConfig: {
        ...selectedNode.dmnConfig,
        rules: [...selectedNode.dmnConfig.rules, newRule],
      },
    });
  };

  const handleRemoveDmnRule = (id: string) => {
    if (!selectedNode.dmnConfig) return;
    onUpdateNode({
      ...selectedNode,
      dmnConfig: {
        ...selectedNode.dmnConfig,
        rules: selectedNode.dmnConfig.rules.filter((r) => r.id !== id),
      },
    });
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
          {(selectedNode.type === 'gateway' || selectedNode.type === 'event') && <GitFork className="w-4 h-4 text-[#F4A261]" />}
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
              <span className="text-[10px] bg-[#9D4EDD]/20 text-[#9D4EDD] px-2 py-0.5 rounded-full font-mono">
                Gemini Engine
              </span>
            </div>

            {/* Model Selection */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">LLM Engine Model</label>
              <select
                value={selectedNode.agentConfig.model}
                onChange={(e) => handleAgentChange('model', e.target.value)}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#9D4EDD]"
              >
                <option value="gemini-3.6-flash">gemini-3.6-flash (Fast Reasoning)</option>
                <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Complex Logic)</option>
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Ultra Low Latency)</option>
              </select>
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

            {/* Tools Checklist */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Bound Tool APIs</label>
              <div className="space-y-1 bg-[#1A1614] p-2 rounded-xl border border-[#3A322E]">
                {['Database Query', 'Vision OCR Engine', 'ERP Connector', 'Stripe Charge Logs', 'Sanctions Database'].map((tool) => {
                  const isBound = selectedNode.agentConfig?.tools.includes(tool);
                  return (
                    <label key={tool} className="flex items-center gap-2 text-xs text-[#EAE3D9] cursor-pointer p-1 hover:bg-[#25201D] rounded">
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
          <div className="space-y-4 pt-4 border-t border-[#3A322E]">
            <span className="text-[11px] font-semibold tracking-wider text-[#2A9D8F] uppercase block">
              Decision Table (Law / Guardrail)
            </span>

            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Decision Key ID</label>
              <input
                type="text"
                value={selectedNode.dmnConfig.decisionKey}
                onChange={(e) => handleDmnChange('decisionKey', e.target.value)}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs font-mono text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Hit Policy</label>
              <select
                value={selectedNode.dmnConfig.hitPolicy}
                onChange={(e) => handleDmnChange('hitPolicy', e.target.value)}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
              >
                <option value="FIRST">FIRST (First matching rule applies)</option>
                <option value="UNIQUE">UNIQUE (Only one rule can match)</option>
                <option value="COLLECT">COLLECT (Accumulate all outcomes)</option>
              </select>
            </div>

            {/* Input Expressions Editor */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Input Expressions</label>
              <div className="space-y-1 bg-[#1A1614] p-2 rounded-xl border border-[#3A322E]">
                {selectedNode.dmnConfig.inputs.map((input, idx) => (
                  <div key={`${input.name}-${idx}`} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={input.name}
                      placeholder="score"
                      onChange={(e) => {
                        const inputs = [...selectedNode.dmnConfig!.inputs];
                        inputs[idx] = { ...inputs[idx], name: e.target.value };
                        handleDmnChange('inputs', inputs);
                      }}
                      className="w-24 bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
                    />
                    <input
                      type="text"
                      value={input.expr || ''}
                      placeholder="${extract_data.credit_score}"
                      onChange={(e) => {
                        const inputs = [...selectedNode.dmnConfig!.inputs];
                        inputs[idx] = { ...inputs[idx], expr: e.target.value };
                        handleDmnChange('inputs', inputs);
                      }}
                      className="flex-1 min-w-0 bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#2A9D8F] focus:outline-none focus:border-[#2A9D8F]"
                    />
                    <button
                      onClick={() => {
                        const inputs = selectedNode.dmnConfig!.inputs.filter((_, i) => i !== idx);
                        handleDmnChange('inputs', inputs);
                      }}
                      className="text-red-400 hover:text-red-300 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    handleDmnChange('inputs', [
                      ...selectedNode.dmnConfig!.inputs,
                      { name: `input_${selectedNode.dmnConfig!.inputs.length + 1}`, expr: '' },
                    ])
                  }
                  className="text-xs text-[#2A9D8F] hover:text-[#38c2b1] flex items-center gap-1 font-medium"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Input</span>
                </button>
              </div>
            </div>

            {/* Rule Table Editor */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-[#EAE3D9]">Rules Matrix ({selectedNode.dmnConfig.rules.length})</span>
                <button
                  onClick={handleAddDmnRule}
                  className="text-xs text-[#2A9D8F] hover:text-[#38c2b1] flex items-center gap-1 font-medium"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Rule</span>
                </button>
              </div>

              <div className="space-y-2">
                {selectedNode.dmnConfig.rules.map((rule, idx) => (
                  <div key={rule.id} className="p-2.5 bg-[#1A1614] rounded-xl border border-[#3A322E] text-xs space-y-1.5 relative group">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-[#2A9D8F]">Rule #{idx + 1}</span>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-[10px] text-[#A89F91] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rule.otherwise || false}
                            onChange={(e) => {
                              const updated = [...selectedNode.dmnConfig!.rules];
                              // Only one fallback (else) rule per decision table.
                              updated.forEach((r) => {
                                r.otherwise = false;
                              });
                              updated[idx] = {
                                ...updated[idx],
                                otherwise: e.target.checked,
                                when: e.target.checked ? undefined : updated[idx].when,
                              };
                              handleDmnChange('rules', updated);
                            }}
                            className="accent-[#2A9D8F] rounded"
                          />
                          otherwise
                        </label>
                        <button
                          onClick={() => handleRemoveDmnRule(rule.id)}
                          className="text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    {rule.otherwise ? (
                      <span className="text-[10px] text-[#F4A261] block font-semibold">
                        ↳ Else branch — applied when no other rule matches
                      </span>
                    ) : (
                      <div>
                        <span className="text-[10px] text-[#A89F91] block">WHEN (deterministic condition)</span>
                        <input
                          type="text"
                          value={rule.when || ''}
                          placeholder="score >= 750 and income >= 60000"
                          onChange={(e) => {
                            const updated = [...selectedNode.dmnConfig!.rules];
                            updated[idx] = { ...updated[idx], when: e.target.value };
                            handleDmnChange('rules', updated);
                          }}
                          className="w-full bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
                        />
                      </div>
                    )}
                    <div>
                      <span className="text-[10px] text-[#A89F91] block">THEN outputs (one `key = value` per line)</span>
                      <textarea
                        rows={2}
                        value={thenDrafts[rule.id] ??
                          Object.entries(rule.then || {})
                            .map(([k, v]) => `${k} = ${String(v)}`)
                            .join('\n')}
                        placeholder={'risk_level = LOW\nauto_approve = true'}
                        onChange={(e) =>
                          setThenDrafts((prev) => ({ ...prev, [rule.id]: e.target.value }))
                        }
                        onBlur={(e) => {
                          const parsed: Record<string, string | number | boolean> = {};
                          e.target.value.split(/\n|;/).forEach((line) => {
                            const m = line.trim().match(/^([\w.]+)\s*[:=]\s*(.+)$/);
                            if (!m) return;
                            let value: string | number | boolean = m[2].trim();
                            if (value === 'true') value = true;
                            else if (value === 'false') value = false;
                            else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
                            parsed[m[1].trim()] = value;
                          });
                          const updated = [...selectedNode.dmnConfig!.rules];
                          updated[idx] = { ...updated[idx], then: parsed };
                          handleDmnChange('rules', updated);
                          setThenDrafts((prev) => {
                            const next = { ...prev };
                            delete next[rule.id];
                            return next;
                          });
                        }}
                        className="w-full bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#2A9D8F] focus:outline-none focus:border-[#2A9D8F]"
                      />
                    </div>
                  </div>
                ))}
              </div>
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
