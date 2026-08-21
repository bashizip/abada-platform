import React from 'react';
import { WorkflowNode, WorkflowFile, AgentConfig, HumanConfig } from '@/types';
import { AGENT_MODEL_OPTIONS, DEFAULT_AGENT_MODEL } from '@/lib/agentModels';
import { 
  Bot, 
  UserCheck, 
  Table, 
  GitFork, 
  GitMerge,
  Circle, 
  Plus, 
  Trash2, 
  ShieldAlert, 
  Sparkles, 
  Clock, 
  Zap, 
  Sliders, 
  Info,
  Terminal,
  Mail,
  Radio,
  GitCompare
} from 'lucide-react';
import { TooltipProvider, UITooltip } from '@/components/ui';

interface PropertiesInspectorProps {
  selectedNode: WorkflowNode | null;
  onUpdateNode: (updatedNode: WorkflowNode) => void;
  onRunAgentTest?: (agentConfig: AgentConfig, testInput: string) => Promise<unknown>;
  nodeCount: number;
  /** Full active workflow — enables the event-gateway competing-events editor. */
  workflow?: WorkflowFile;
  /** Mutates the active workflow (nodes + edges) for event-gateway child authoring. */
  onUpdateWorkflow?: (updater: (wf: WorkflowFile) => WorkflowFile) => void;
}

export const PropertiesInspector: React.FC<PropertiesInspectorProps> = ({
  selectedNode,
  onUpdateNode,
  nodeCount,
  workflow,
  onUpdateWorkflow,
}) => {

  if (!selectedNode) {
    return (
      <TooltipProvider delayDuration={0}>
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
      </TooltipProvider>
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
  const handleAgentNumber = (field: 'maxTokens' | 'maxAttempts' | 'timeoutMs' | 'retryBackoffMs', raw: string) => {
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
  const humanConfig = selectedNode.humanConfig;
  const currentModel = agentConfig?.model || DEFAULT_AGENT_MODEL;
  const modelOptions = AGENT_MODEL_OPTIONS.includes(currentModel)
    ? AGENT_MODEL_OPTIONS
    : [currentModel, ...AGENT_MODEL_OPTIONS];

  /* ---- Event-gateway authoring: the gateway's competing catch events are
     materialized canvas nodes (gateway → catch → next edges), so the editor
     below reads and writes the shared workflow nodes/edges directly. ---- */

  /** Catch-event children currently wired out of the selected event gateway. */
  const eventGatewayChildren = (): WorkflowNode[] => {
    if (!workflow) return [];
    return workflow.edges
      .filter((e) => e.source === selectedNode.id)
      .map((e) => workflow.nodes.find((n) => n.id === e.target))
      .filter((n): n is WorkflowNode => !!n && n.type === 'event'
        && (n.subtype === 'message' || n.subtype === 'timer' || n.subtype === 'signal'));
  };

  /** The successor a catch child currently routes to (its outgoing edge). */
  const childNextTarget = (childId: string): string | undefined =>
    workflow?.edges.find((e) => e.source === childId)?.target;

  const handleChildEventKindChange = (childId: string, subtype: 'message' | 'timer' | 'signal') => {
    onUpdateWorkflow?.((wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => n.id === childId
        ? { ...n, subtype, catchEventConfig: { definitionRef: '' } }
        : n),
    }));
  };

  const handleChildEventDefinitionChange = (childId: string, definitionRef: string) => {
    onUpdateWorkflow?.((wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => n.id === childId
        ? { ...n, catchEventConfig: { definitionRef } }
        : n),
    }));
  };

  const handleChildEventNextChange = (childId: string, target: string) => {
    onUpdateWorkflow?.((wf) => {
      const existing = wf.edges.find((e) => e.source === childId);
      if (!target) return { ...wf, edges: wf.edges.filter((e) => e.source !== childId) };
      if (existing) {
        return { ...wf, edges: wf.edges.map((e) => (e.id === existing.id ? { ...e, target } : e)) };
      }
      return { ...wf, edges: [...wf.edges, { id: `e-${Date.now()}`, source: childId, target, label: 'Next' }] };
    });
  };

  const handleAddChildEvent = (subtype: 'message' | 'timer' | 'signal') => {
    const yOffset = eventGatewayChildren().length * 84;
    onUpdateWorkflow?.((wf) => {
      const childId = `${selectedNode.id}_e${Date.now()}`;
      const child: WorkflowNode = {
        id: childId,
        type: 'event',
        subtype,
        title: subtype === 'message' ? 'Message Catch' : subtype === 'timer' ? 'Timer Catch' : 'Signal Catch',
        description: 'Competing catch event of the event gateway',
        x: selectedNode.x + 260,
        y: selectedNode.y + yOffset,
        catchEventConfig: { definitionRef: '' },
      };
      return {
        ...wf,
        nodes: [...wf.nodes, child],
        edges: [...wf.edges, { id: `e-${Date.now()}`, source: selectedNode.id, target: childId, label: 'Race' }],
      };
    });
  };

  const handleRemoveChildEvent = (childId: string) => {
    onUpdateWorkflow?.((wf) => ({
      ...wf,
      nodes: wf.nodes.filter((n) => n.id !== childId),
      edges: wf.edges.filter((e) => e.source !== childId && e.target !== childId),
    }));
  };

  const isEventGateway = selectedNode.type === 'gateway' && selectedNode.subtype === 'event';
  const gatewayChildren = isEventGateway ? eventGatewayChildren() : [];
  const gatewayChildIds = new Set(gatewayChildren.map((c) => c.id));
  const gatewayNextOptions = workflow?.nodes
    .filter((n) => n.id !== selectedNode.id && !gatewayChildIds.has(n.id)) ?? [];
  const gatewayRoutedCount = gatewayChildren.filter((c) =>
    (c.catchEventConfig?.definitionRef || '').trim() !== '' && !!childNextTarget(c.id)
  ).length;

  return (
    <TooltipProvider delayDuration={0}>
    <aside className="w-80 bg-[#25201D] border-l border-[#3A322E] flex flex-col h-full z-10 shrink-0 overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-[#3A322E] bg-[#1A1614]/60 sticky top-0 z-10 backdrop-blur-md flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {selectedNode.type === 'agent' && <Bot className="w-4 h-4 text-[#9D4EDD]" />}
          {selectedNode.type === 'human' && <UserCheck className="w-4 h-4 text-[#E76F51]" />}
          {selectedNode.type === 'dmn' && <Table className="w-4 h-4 text-[#2A9D8F]" />}
          {selectedNode.type === 'engine-task' && <Zap className="w-4 h-4 text-[#90A955]" />}
          {selectedNode.type === 'gateway' && (selectedNode.subtype === 'event'
            ? <GitCompare className="w-4 h-4 text-[#F4A261]" />
            : selectedNode.subtype === 'parallel'
              ? <GitMerge className="w-4 h-4 text-[#F4A261]" />
              : <GitFork className="w-4 h-4 text-[#F4A261]" />)}
          {selectedNode.type === 'event'
            && (selectedNode.subtype === 'message'
              ? <Mail className="w-4 h-4 text-[#F4A261]" />
              : selectedNode.subtype === 'timer'
                ? <Clock className="w-4 h-4 text-[#F4A261]" />
                : selectedNode.subtype === 'signal'
                  ? <Radio className="w-4 h-4 text-[#F4A261]" />
                  : <Circle className="w-4 h-4 text-[#F4A261]" />)}
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

            {/* Profile — read-only badge (abada.agent/v1 is currently the only
                supported value per the APL node reference) */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Worker Profile</label>
              <div className="flex items-center gap-2 w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs">
                <span className="font-mono text-[#EAE3D9]">{agentConfig?.profileVersion || 'abada.agent/v1'}</span>
                <span className="text-[10px] text-[#A89F91] bg-[#9D4EDD]/10 px-1.5 py-0.5 rounded">Default &amp; only supported</span>
              </div>
            </div>

            {/* Input Variable Bindings */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Prompt Inputs (bindings)</label>
              <p className="text-[10px] text-[#A89F91]">Named variable expressions (e.g. <span className="font-mono text-[#9D4EDD]">${'{'}{'payload'}{'}'}</span>) bound into the prompt scope.</p>
              <div className="rounded-lg border border-[#3A322E] divide-y divide-[#3A322E] bg-[#1A1614] overflow-hidden">
                {Object.entries(agentConfig?.inputs || {}).map(([name, expr]) => (
                  <div key={name} className="group flex items-center gap-1.5 px-2 py-1.5">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        const next: Record<string, string> = { ...agentConfig?.inputs };
                        const oldExpr = next[name];
                        delete next[name];
                        next[e.target.value] = oldExpr;
                        handleAgentChange('inputs', next);
                      }}
                      className="w-28 bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#EAE3D9] focus:outline-none focus:border-[#9D4EDD]"
                    />
                    <input
                      type="text"
                      value={expr}
                      onChange={(e) => handleAgentChange('inputs', { ...agentConfig?.inputs, [name]: e.target.value })}
                      className="flex-1 min-w-0 bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#9D4EDD] focus:outline-none focus:border-[#9D4EDD]"
                      placeholder='${payload}'
                    />
                    <button
                      onClick={() => {
                        const next: Record<string, string> = { ...agentConfig?.inputs };
                        delete next[name];
                        handleAgentChange('inputs', next);
                      }}
                      className="text-red-400 hover:text-red-300 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove input binding"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const next: Record<string, string> = { ...agentConfig?.inputs, input_1: '${payload}' };
                    handleAgentChange('inputs', next);
                  }}
                  className="w-full text-left text-xs text-[#9D4EDD] hover:text-[#b56ef2] flex items-center gap-1 font-medium px-3 py-2"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Input Binding</span>
                </button>
              </div>
            </div>

            {/* Result Variable + Output Schema */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-[#A89F91] block">Result Variable</label>
                <input
                  type="text"
                  placeholder={selectedNode.id + '_result'}
                  value={agentConfig?.resultVariable ?? ''}
                  onChange={(e) => handleAgentChange('resultVariable', e.target.value || undefined)}
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs font-mono text-[#EAE3D9] focus:outline-none focus:border-[#9D4EDD]"
                />
                <p className="text-[10px] text-[#A89F91]">Where the agent output is written. Empty = engine default.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[#A89F91] block">Output Schema (JSON)</label>
                <textarea
                  rows={3}
                  value={JSON.stringify(agentConfig?.outputSchema ?? {}, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : {};
                      handleAgentChange('outputSchema', parsed);
                    } catch {
                      handleAgentChange('outputSchema', undefined);
                    }
                  }}
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-[10px] font-mono text-[#9D4EDD] focus:outline-none focus:border-[#9D4EDD] resize-y"
                  placeholder='{"approved": true}'
                />
                <p className="text-[10px] text-[#A89F91]">Expected JSON shape; the worker validates against it.</p>
              </div>
            </div>

            {/* Timeout & Retry Backoff */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-[#A89F91] block">Timeout (ms)</label>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  placeholder="60000"
                  value={agentConfig?.timeoutMs ?? ''}
                  onChange={(e) => handleAgentNumber('timeoutMs', e.target.value)}
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs font-mono text-[#9D4EDD] focus:outline-none focus:border-[#9D4EDD]"
                />
                <p className="text-[10px] text-[#A89F91]">Worker call timeout. Empty = engine default (60 000).</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[#A89F91] block">Retry Backoff (ms)</label>
                <input
                  type="number"
                  min="100"
                  step="100"
                  placeholder="2000"
                  value={agentConfig?.retryBackoffMs ?? ''}
                  onChange={(e) => handleAgentNumber('retryBackoffMs', e.target.value)}
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs font-mono text-[#9D4EDD] focus:outline-none focus:border-[#9D4EDD]"
                />
                <p className="text-[10px] text-[#A89F91]">Pause between durable retries. Empty = engine default (2 000).</p>
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
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#EAE3D9] block">Agent Execution Contract</span>
                <span className="text-[10px] text-[#2A9D8F] font-mono">abada.agent/v1</span>
              </div>
              <p className="text-[11px] text-[#A89F91] leading-relaxed bg-[#1A1614] p-2.5 rounded-xl border border-[#3A322E]">
                Agent execution is bounded by the Engine runtime contract. Live execution runs via external workers (<span className="font-mono text-[#F4A261]">abada-agent-worker</span>) when instances are started on the Engine.
              </p>
              <UITooltip content="Use 'Dry Run' to mock agent choices locally, or 'Deploy & Start' to run live on the engine with the external agent worker.">
                <button
                  type="button"
                  disabled
                  className="w-full py-2 bg-[#9D4EDD]/30 border border-[#9D4EDD]/40 text-[#A89F91] font-semibold text-xs rounded-xl cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Bot className="w-3.5 h-3.5 text-[#9D4EDD]" />
                  <span>External Worker Test (Deploy Required)</span>
                </button>
              </UITooltip>
            </div>

            {/* Error Flow Routing (on_error) */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Error Route (on_error)</label>
              <p className="text-[10px] text-[#A89F91] leading-relaxed">
                When the engine task fails, the instance routes here instead of the normal successor. Drawn as an error edge.
              </p>
              <select
                value={selectedNode.engineTaskConfig?.onError || ''}
                onChange={(e) => onUpdateNode({
                  ...selectedNode,
                  engineTaskConfig: {
                    service: selectedNode.engineTaskConfig?.service || 'abada:service',
                    onError: e.target.value || undefined,
                  },
                })}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs font-mono text-[#EAE3D9] focus:outline-none focus:border-[#E76F51]"
              >
                <option value="">— no error route —</option>
                {workflow?.nodes
                  .filter((n) => n.id !== selectedNode.id)
                  .map((n) => (
                    <option key={n.id} value={n.id}>{n.title || n.id}</option>
                  ))}
              </select>
            </div>
          </div>
        )}

        {/* Script Configuration (in-transaction server-side script) */}
        {selectedNode.type === 'script' && (
          <div className="space-y-4 pt-4 border-t border-[#3A322E]">
            <span className="text-[11px] font-semibold tracking-wider text-[#2A9D8F] uppercase block flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              Script Configuration
            </span>

            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Script Body</label>
              <textarea
                rows={8}
                value={selectedNode.scriptConfig?.script || ''}
                onChange={(e) => onUpdateNode({
                  ...selectedNode,
                  scriptConfig: {
                    ...(selectedNode.scriptConfig || { format: 'javascript' }),
                    script: e.target.value,
                  },
                })}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] font-mono leading-relaxed focus:outline-none focus:border-[#2A9D8F] resize-y"
                placeholder="variables.put('result', variables.input * 2);"
              />
              <p className="text-[10px] text-[#A89F91] leading-relaxed">
                Executed by the engine inside the workflow transaction. All instance
                variables are bound by name plus the <span className="font-mono text-[#2A9D8F]">variables</span>
                map — the APL form of an embedded Java delegate.
              </p>
            </div>

            {/* Script Format */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">Script Engine</label>
              <select
                value={selectedNode.scriptConfig?.format || 'javascript'}
                onChange={(e) => onUpdateNode({
                  ...selectedNode,
                  scriptConfig: {
                    script: selectedNode.scriptConfig?.script || '',
                    format: e.target.value,
                  },
                })}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#2A9D8F] focus:outline-none focus:border-[#2A9D8F]"
              >
                <option value="javascript">JavaScript (ECMAScript)</option>
              </select>
              <p className="text-[10px] text-[#A89F91]">Engine script engine name — defaults to <span className="font-mono text-[#2A9D8F]">javascript</span>.</p>
            </div>
          </div>
        )}

        {/* Catch Event Configuration (durable message/timer/signal subscription) */}
        {selectedNode.type === 'event'
          && (selectedNode.subtype === 'message' || selectedNode.subtype === 'timer' || selectedNode.subtype === 'signal')
          && (
          <div className="space-y-4 pt-4 border-t border-[#3A322E]">
            <span className="text-[11px] font-semibold tracking-wider text-[#F4A261] uppercase block flex items-center gap-1.5">
              {selectedNode.subtype === 'message'
                ? <Mail className="w-3.5 h-3.5" />
                : selectedNode.subtype === 'timer'
                  ? <Clock className="w-3.5 h-3.5" />
                  : <Radio className="w-3.5 h-3.5" />}
              {selectedNode.subtype === 'message'
                ? 'Message Catch'
                : selectedNode.subtype === 'timer'
                  ? 'Timer Catch'
                  : 'Signal Catch'} Configuration
            </span>

            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">
                {selectedNode.subtype === 'message'
                  ? 'Message Name'
                  : selectedNode.subtype === 'timer'
                    ? 'Duration (ISO-8601)'
                    : 'Signal Name'}
              </label>
              <input
                type="text"
                value={selectedNode.catchEventConfig?.definitionRef || ''}
                onChange={(e) => onUpdateNode({
                  ...selectedNode,
                  catchEventConfig: {
                    definitionRef: e.target.value,
                  },
                })}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#F4A261] font-mono"
                placeholder={selectedNode.subtype === 'timer' ? 'PT1H' : 'MyMessage'}
              />
              <p className="text-[10px] text-[#A89F91] leading-relaxed">
                {selectedNode.subtype === 'message'
                  ? 'The instance suspends on a durable subscription and resumes when a message with this name is correlated against the correlationKey variable.'
                  : selectedNode.subtype === 'timer'
                    ? 'The instance suspends and the durable job scheduler resumes it after the duration elapses.'
                    : 'The instance suspends on a durable subscription and resumes when this signal is broadcast.'}
              </p>
            </div>
          </div>
        )}

        {/* Gateway Configuration */}
        {selectedNode.type === 'gateway' && selectedNode.subtype !== 'event' && (
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
                <option value="inclusive">Inclusive — every matching branch fires</option>
                <option value="event">Event — competing catch events, first to fire wins</option>
              </select>
              <p className="text-[10px] text-[#A89F91] leading-relaxed">
                {selectedNode.subtype === 'parallel'
                  ? 'Fork: connect each outgoing edge; the engine runs every branch concurrently. Join: upstream nodes converge back here and it continues along its single outgoing edge.'
                  : selectedNode.subtype === 'inclusive'
                    ? 'Fork: every outgoing edge whose condition matches fires (zero matches need an else/fallback edge, or the run fails loudly). Join: upstream nodes converge back here and it continues along its single outgoing edge.'
                    : 'Conditional flows evaluate in order; the last flow becomes the default branch.'}
              </p>
            </div>
          </div>
        )}

        {/* Event Gateway Configuration — inline competing catch events */}
        {isEventGateway && workflow && onUpdateWorkflow && (
          <div className="space-y-4 pt-4 border-t border-[#3A322E]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider text-[#F4A261] uppercase flex items-center gap-1.5">
                <GitCompare className="w-3.5 h-3.5" />
                Competing Events
              </span>
              <span className="text-[10px] font-mono text-[#A89F91] bg-[#1A1614] px-2 py-0.5 rounded border border-[#3A322E]">
                {gatewayChildren.length} catch(es)
              </span>
            </div>

            <p className="text-[10px] text-[#A89F91] leading-relaxed">
              The instance waits on every catch below; the first to fire advances
              and the engine cancels every sibling wait state in the same
              transaction. Each catch needs a name and a successor.
            </p>

            {gatewayChildren.length === 0 && (
              <div className="text-[11px] text-[#A89F91] leading-relaxed p-3 bg-[#1A1614] rounded-xl border border-dashed border-[#3A322E]">
                No competing events yet. Add at least two below (or drag catch events
                onto the canvas and connect them to this gateway).
              </div>
            )}

            {gatewayChildren.map((child) => (
              <div key={child.id} className="p-3 bg-[#1A1614] rounded-xl border border-[#3A322E] space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={child.subtype}
                    onChange={(e) => handleChildEventKindChange(child.id, e.target.value as 'message' | 'timer' | 'signal')}
                    className="flex-1 bg-[#1A1614] border border-[#3A322E] rounded-lg px-2 py-1.5 text-[11px] text-[#EAE3D9] focus:outline-none focus:border-[#F4A261]"
                  >
                    <option value="message">Message catch</option>
                    <option value="timer">Timer</option>
                    <option value="signal">Signal</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleRemoveChildEvent(child.id)}
                    className="p-1.5 rounded-lg border border-[#E76F51]/30 text-[#E76F51] hover:bg-[#E76F51]/15 transition-colors shrink-0"
                    title="Remove this competing event (deletes its canvas node and flows)"
                    aria-label="Remove competing event"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-[#A89F91] block">
                    {child.subtype === 'message'
                      ? 'Message Name'
                      : child.subtype === 'timer'
                        ? 'Duration (ISO-8601)'
                        : 'Signal Name'}
                  </label>
                  <input
                    type="text"
                    value={child.catchEventConfig?.definitionRef || ''}
                    onChange={(e) => handleChildEventDefinitionChange(child.id, e.target.value)}
                    className="w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-2.5 py-1.5 text-[11px] text-[#EAE3D9] font-mono focus:outline-none focus:border-[#F4A261]"
                    placeholder={child.subtype === 'timer' ? 'PT1H' : child.subtype === 'message' ? 'MyMessage' : 'MySignal'}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-[#A89F91] block">Continues To</label>
                  <select
                    value={childNextTarget(child.id) || ''}
                    onChange={(e) => handleChildEventNextChange(child.id, e.target.value)}
                    className="w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-2.5 py-1.5 text-[11px] text-[#EAE3D9] focus:outline-none focus:border-[#F4A261]"
                  >
                    <option value="">— select successor (required) —</option>
                    {gatewayNextOptions.map((n) => (
                      <option key={n.id} value={n.id}>{n.title || n.id}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}

            <div className="flex gap-2">
              {(['message', 'timer', 'signal'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => handleAddChildEvent(kind)}
                  className="flex-1 py-1.5 rounded-lg border border-[#F4A261]/30 bg-[#F4A261]/10 text-[11px] font-semibold text-[#F4A261] hover:bg-[#F4A261]/20 transition-colors flex items-center justify-center gap-1"
                >
                  {kind === 'message'
                    ? <Mail className="w-3 h-3" />
                    : kind === 'timer'
                      ? <Clock className="w-3 h-3" />
                      : <Radio className="w-3 h-3" />}
                  Add {kind === 'message' ? 'Message' : kind === 'timer' ? 'Timer' : 'Signal'}
                </button>
              ))}
            </div>

            <div className={`p-2.5 rounded-lg border text-[10px] leading-relaxed ${
              gatewayRoutedCount >= 2
                ? 'border-[#90A955]/30 bg-[#90A955]/10 text-[#90A955]'
                : 'border-[#E76F51]/30 bg-[#E76F51]/10 text-[#E76F51]'
            }`}>
              {gatewayRoutedCount >= 2
                ? `Ready: ${gatewayChildren.length} competing event(s) with a name and a successor. First to fire wins.`
                : `Only ${gatewayRoutedCount} of ${gatewayChildren.length} event(s) are fully routed (need a name and a successor). The engine requires at least two competing events.`}
            </div>
          </div>
        )}

        {/* Human Input Configuration */}
         {selectedNode.type === 'human' && humanConfig && (
           <div className="space-y-4 pt-4 border-t border-[#3A322E]">
             <span className="text-[11px] font-semibold tracking-wider text-[#E76F51] uppercase block flex items-center gap-1.5">
               <UserCheck className="w-3.5 h-3.5" />
               Human Input
             </span>

             <div className="space-y-1.5">
               <label className="text-xs text-[#A89F91] block">Form ID</label>
               <input
                 type="text"
                 value={humanConfig.formKey || ''}
                 onChange={(e) => handleHumanChange('formKey', e.target.value || undefined)}
                 className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs font-mono text-[#EAE3D9] focus:outline-none focus:border-[#E76F51]"
                 placeholder="e.g. loan-approval-form"
               />
               <p className="text-[10px] text-[#A89F91]">Optional form key for task-form rendering. Empty = engine default.</p>
             </div>

             <div className="space-y-1.5">
               <label className="text-xs text-[#A89F91] block">Assignee Groups / Users</label>
               <p className="text-[10px] text-[#A89F91]">At least one required. These groups may claim the task.</p>
               <div className="rounded-lg border border-[#3A322E] divide-y divide-[#3A322E] bg-[#1A1614] overflow-hidden">
                 {humanConfig.assignees.map((assignee, idx) => (
                  <div key={idx} className="group flex items-center gap-1.5 px-2 py-1.5">
                    <input
                      type="text"
                      value={assignee}
                      placeholder="risk-officers"
                      onChange={(e) => {
                        const assignees = [...humanConfig.assignees];
                        assignees[idx] = e.target.value;
                        handleHumanChange('assignees', assignees);
                      }}
                      className="flex-1 min-w-0 bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#EAE3D9] focus:outline-none focus:border-[#E76F51]"
                    />
                    <button
                      onClick={() => {
                        const assignees = humanConfig.assignees.filter((_, i) => i !== idx);
                        handleHumanChange('assignees', assignees);
                      }}
                      className="text-red-400 hover:text-red-300 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove assignee"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button
                    onClick={() => {
                      const assignees = [...humanConfig.assignees, ''];
                      handleHumanChange('assignees', assignees);
                    }}
                  className="w-full text-left text-xs text-[#E76F51] hover:text-[#F4A261] flex items-center gap-1 font-medium px-3 py-2"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Assignee</span>
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block">SLA Timer (Hours)</label>
              <input
                type="number"
                value={humanConfig.slaHours}
                onChange={(e) => handleHumanChange('slaHours', Number(e.target.value))}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#E76F51]"
              />
            </div>

            <div className="p-3 bg-[#1A1614] rounded-xl border border-[#E76F51]/30 space-y-2">
              <label className="flex items-center justify-between text-xs text-[#EAE3D9] cursor-pointer">
                <span>Require Dual Manager Sign-off</span>
                <input
                  type="checkbox"
                  checked={humanConfig.requireDoubleSignOff || false}
                  onChange={(e) => handleHumanChange('requireDoubleSignOff', e.target.checked)}
                  className="accent-[#E76F51] rounded"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </aside>
    </TooltipProvider>
  );
};
