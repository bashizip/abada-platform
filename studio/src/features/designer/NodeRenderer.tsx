import React, { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { 
  Bot, 
  UserCheck, 
  Table, 
  GitFork, 
  Circle,
  Plus,
  Clock
} from 'lucide-react';
import { WorkflowNode, NodeType } from '@/types';

export type AbadaNodeType = Node<WorkflowNode & Record<string, unknown> & {
  isSelected?: boolean;
  isActiveSim?: boolean;
  onConnectStart?: (nodeId: string) => void;
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

const getNodeIcon = (type: NodeType) => {
  switch (type) {
    case 'agent':
      return <Bot className="w-4 h-4 text-[#9D4EDD]" />;
    case 'human':
      return <UserCheck className="w-4 h-4 text-[#E76F51]" />;
    case 'dmn':
      return <Table className="w-4 h-4 text-[#2A9D8F]" />;
    case 'gateway':
      return <GitFork className="w-4 h-4 text-[#F4A261]" />;
    case 'event':
      return <Circle className="w-4 h-4 text-[#F4A261]" />;
    default:
      return <Bot className="w-4 h-4 text-[#F4A261]" />;
  }
};

export const AbadaNode = memo(({ data, selected }: NodeProps<AbadaNodeType>) => {
  const styles = getNodeColor(data.type);
  const isSelected = selected;
  const isActiveSim = data.isActiveSim;
  
  const isAgentGlow = data.type === 'agent' && (isSelected || isActiveSim);

  return (
    <div
      className={`w-52 bg-[#25201D] rounded-2xl border ${styles.border} shadow-warm-lg transition-shadow z-10 group ${
        isSelected ? 'ring-2 ring-[#F4A261] ring-offset-2 ring-offset-[#1A1614]' : ''
      } ${isAgentGlow ? 'glow-amethyst' : ''} ${
        isActiveSim ? 'scale-105 transition-transform' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      
      <div className={`px-3 py-2.5 rounded-t-2xl ${styles.headerBg} border-b border-[#3A322E] flex items-center justify-between`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1 rounded-lg ${styles.badgeBg}`}>
            {getNodeIcon(data.type)}
          </div>
          <span className="text-xs font-semibold text-[#EAE3D9] truncate">
            {data.title}
          </span>
        </div>
        <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${styles.badgeBg} ${styles.text}`}>
          {data.type}
        </span>
      </div>

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

        {isActiveSim && (
          <div className="pt-1 flex items-center gap-1.5 text-[10px] text-[#9D4EDD] font-semibold animate-pulse">
            <Clock className="w-3 h-3 animate-spin" />
            <span>Executing AI Node Logic...</span>
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
