import React, { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { 
  Bot, 
  UserCheck, 
  Table, 
  GitFork, 
  GitMerge,
  Zap,
  Code2,
  Circle,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2
} from 'lucide-react';
import { WorkflowNode, NodeType } from '@/types';
import type { DiffChangeKind } from '@/lib/aiDiff/types';

export type AbadaNodeType = Node<WorkflowNode & Record<string, unknown> & {
  isSelected?: boolean;
  isActiveSim?: boolean;
  isLiveCurrent?: boolean;
  diffKind?: DiffChangeKind | null;
  diffAnnotation?: string;
  onConnectStart?: (nodeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}, 'abadaNode'>;

const getNodeColor = (type: NodeType) => {
  switch (type) {
    case 'agent':
      return {
        border: 'border-[#9D4EDD]',
        bg: 'bg-[#25201D]',
        headerBg: 'bg-[#9D4EDD]/15',
        text: 'text-[#9D4EDD]',
        badgeBg: 'bg-[#9D4EDD]/20',
      };
    case 'human':
      return {
        border: 'border-[#E76F51]',
        bg: 'bg-[#25201D]',
        headerBg: 'bg-[#E76F51]/15',
        text: 'text-[#E76F51]',
        badgeBg: 'bg-[#E76F51]/20',
      };
    case 'dmn':
      return {
        border: 'border-[#2A9D8F]',
        bg: 'bg-[#25201D]',
        headerBg: 'bg-[#2A9D8F]/15',
        text: 'text-[#2A9D8F]',
        badgeBg: 'bg-[#2A9D8F]/20',
      };
    case 'engine-task':
      return {
        border: 'border-[#90A955]',
        bg: 'bg-[#25201D]',
        headerBg: 'bg-[#90A955]/15',
        text: 'text-[#90A955]',
        badgeBg: 'bg-[#90A955]/20',
      };
    case 'script':
      return {
        border: 'border-[#2A9D8F]',
        bg: 'bg-[#25201D]',
        headerBg: 'bg-[#2A9D8F]/15',
        text: 'text-[#2A9D8F]',
        badgeBg: 'bg-[#2A9D8F]/20',
      };
    case 'gateway':
    case 'event':
    default:
      return {
        border: 'border-[#F4A261]',
        bg: 'bg-[#25201D]',
        headerBg: 'bg-[#F4A261]/15',
        text: 'text-[#F4A261]',
        badgeBg: 'bg-[#F4A261]/20',
      };
  }
};

const getNodeIcon = (type: NodeType, subtype?: WorkflowNode['subtype']) => {
  switch (type) {
    case 'agent':
      return <Bot className="w-4 h-4 text-[#9D4EDD]" />;
    case 'engine-task':
      return <Zap className="w-4 h-4 text-[#90A955]" />;
    case 'script':
      return <Code2 className="w-4 h-4 text-[#2A9D8F]" />;
    case 'human':
      return <UserCheck className="w-4 h-4 text-[#E76F51]" />;
    case 'dmn':
      return <Table className="w-4 h-4 text-[#2A9D8F]" />;
    case 'gateway':
      return subtype === 'parallel'
        ? <GitMerge className="w-4 h-4 text-[#F4A261]" />
        : <GitFork className="w-4 h-4 text-[#F4A261]" />;
    case 'event':
      return <Circle className="w-4 h-4 text-[#F4A261]" />;
    default:
      return <Bot className="w-4 h-4 text-[#F4A261]" />;
  }
};

export const AbadaNode = memo(({ id, data, selected }: NodeProps<AbadaNodeType>) => {
  const styles = getNodeColor(data.type);
  const isSelected = selected;
  const isActiveSim = data.isActiveSim;
  const isLiveCurrent = data.isLiveCurrent;
  
  // Selection already has a clear ring. Reserving the expensive blurred glow
  // for live execution avoids repainting it on every frame while dragging.
  const isAgentGlow = data.type === 'agent' && isActiveSim;

  const diffRing = data.diffKind === 'added'
    ? 'ring-2 ring-[#90A955] ring-offset-2 ring-offset-[#1A1614]'
    : data.diffKind === 'modified'
      ? 'ring-2 ring-[#F4A261] ring-offset-2 ring-offset-[#1A1614]'
      : data.diffKind === 'removed'
        ? 'ring-2 ring-[#E76F51] ring-offset-2 ring-offset-[#1A1614] opacity-60'
        : '';

  const diffBadge = data.diffKind === 'added'
    ? { label: 'ADDED', cls: 'text-[#90A955] bg-[#90A955]/20 border-[#90A955]/40' }
    : data.diffKind === 'modified'
      ? { label: 'MODIFIED', cls: 'text-[#F4A261] bg-[#F4A261]/20 border-[#F4A261]/40' }
      : data.diffKind === 'removed'
        ? { label: 'REMOVED', cls: 'text-[#E76F51] bg-[#E76F51]/20 border-[#E76F51]/40' }
        : null;

  return (
    <div
      onClick={() => data.onSelectNode?.(id)}
      className={`abada-node-card relative w-52 bg-[#25201D] rounded-2xl border ${styles.border} shadow-warm-lg z-10 group ${
        isSelected ? 'ring-2 ring-[#F4A261] ring-offset-2 ring-offset-[#1A1614]' : ''
      } ${isAgentGlow ? 'glow-amethyst' : ''} ${
        isActiveSim ? 'scale-105 transition-transform' : ''
      } ${data.diffKind ? diffRing : ''}`}
      title={data.diffAnnotation || undefined}
    >
      {isLiveCurrent && (
        <span className="absolute -top-1.5 -right-1.5 z-30 flex h-4 w-4 items-center justify-center" title="Current live activity">
          <span className="absolute h-full w-full rounded-full bg-[#9D4EDD]/50 animate-ping" />
          <span className="relative h-2.5 w-2.5 rounded-full border border-[#EAE3D9] bg-[#9D4EDD]" />
        </span>
      )}
      <Handle type="target" position={Position.Left} className="opacity-0" />
      
      <div className={`px-3 py-2.5 rounded-t-2xl ${styles.headerBg} border-b border-[#3A322E] flex items-center justify-between`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1 rounded-lg ${styles.badgeBg}`}>
            {getNodeIcon(data.type, data.subtype)}
          </div>
          <span className="text-xs font-semibold text-[#EAE3D9] truncate">
            {data.title}
          </span>
        </div>
        <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${styles.badgeBg} ${styles.text}`}>
          {data.type}
        </span>
      </div>

      {data.diffKind && diffBadge && (
        <div className="px-3 pt-2 pb-0">
          <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full border ${diffBadge.cls} inline-block`}>
            {diffBadge.label}
          </span>
        </div>
      )}

      <div className="p-3 text-xs space-y-2">
        <p className="text-[11px] text-[#A89F91] line-clamp-2 leading-relaxed">
          {data.description}
        </p>

        {data.type === 'agent' && data.agentConfig && (
          <div className="pt-2 border-t border-[#3A322E] flex items-center justify-between text-[10px] text-[#A89F91]">
            <span className="font-mono text-[#9D4EDD]">
              Threshold: {data.agentConfig.confidenceThreshold}%
            </span>
            <span className="text-[10px] bg-[#9D4EDD]/20 text-[#9D4EDD] px-1.5 py-0.5 rounded font-mono">
              {data.agentConfig.model}
            </span>
          </div>
        )}

        {data.type === 'dmn' && data.dmnConfig && (
          <div className="pt-2 border-t border-[#3A322E] flex items-center justify-between text-[10px] text-[#2A9D8F]">
            <span className="font-mono">{data.dmnConfig.decisionKey}</span>
            <span className="bg-[#2A9D8F]/20 px-1.5 py-0.5 rounded">
              {data.dmnConfig.rules.length} Rules
            </span>
          </div>
        )}

        {data.type === 'human' && data.humanConfig && (
          <div className="pt-2 border-t border-[#3A322E] flex items-center justify-between text-[10px] text-[#E76F51]">
            <span className="truncate">{data.humanConfig.assigneeRole}</span>
            <span className="bg-[#E76F51]/20 px-1.5 py-0.5 rounded shrink-0">
              SLA {data.humanConfig.slaHours}h
            </span>
          </div>
        )}

        {data.type === 'engine-task' && data.engineTaskConfig && (
          <div className="pt-2 border-t border-[#3A322E] flex items-center justify-between text-[10px] text-[#90A955]">
            <span className="font-mono truncate">{data.engineTaskConfig.service}</span>
            <span className="bg-[#90A955]/20 px-1.5 py-0.5 rounded shrink-0 ml-2">
              Engine
            </span>
          </div>
        )}

        {data.type === 'script' && data.scriptConfig && (
          <div className="pt-2 border-t border-[#3A322E] flex items-center justify-between text-[10px] text-[#2A9D8F]">
            <span className="font-mono truncate">{data.scriptConfig.script.split('\n')[0]}</span>
            <span className="bg-[#2A9D8F]/20 px-1.5 py-0.5 rounded shrink-0 ml-2">
              Script
            </span>
          </div>
        )}

        {isActiveSim && (
          <div className="pt-1 flex items-center gap-1.5 text-[10px] text-[#9D4EDD] font-semibold animate-pulse">
            <Clock className="w-3 h-3 animate-spin" />
            <span>Executing AI Node Logic...</span>
          </div>
        )}

        {/* Live run state — derived from real engine data, never guessed */}
        {data.status && data.status !== 'idle' && (
          <div className="pt-2 border-t border-[#3A322E] flex items-center gap-1.5 text-[10px] font-semibold">
            {data.status === 'completed' && (
              <>
                <CheckCircle2 className="w-3 h-3 text-[#90A955]" />
                <span className="text-[#90A955]">Completed</span>
              </>
            )}
            {data.status === 'failed' && (
              <>
                <XCircle className="w-3 h-3 text-[#E76F51]" />
                <span className="text-[#E76F51]">Failed</span>
              </>
            )}
            {data.status === 'waiting' && (
              <>
                <Clock className="w-3 h-3 text-[#F4A261]" />
                <span className="text-[#F4A261]">Waiting</span>
              </>
            )}
            {data.status === 'running' && (
              <>
                <Loader2 className="w-3 h-3 text-[#9D4EDD] animate-spin" />
                <span className="text-[#9D4EDD]">Running</span>
              </>
            )}
          </div>
        )}
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        className={`w-5 h-5 rounded-full bg-[#1A1614] border-2 ${styles.border} flex items-center justify-center -mr-2.5 z-20`}
      />
    </div>
  );
});

AbadaNode.displayName = 'AbadaNode';
