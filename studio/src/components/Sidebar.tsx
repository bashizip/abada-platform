import React, { useState } from 'react';
import { 
  Folder, 
  FileText, 
  Plus, 
  Bot, 
  UserCheck, 
  GitFork, 
  SlidersHorizontal, 
  PlayCircle, 
  ChevronRight, 
  ChevronDown,
  Sparkles,
  Layers,
  Table,
  Circle,
  HelpCircle,
  Activity,
  RotateCcw
} from 'lucide-react';
import { WorkflowFile, NodeType, getFileFormatLabel, getRuntimeStatusTag } from '@/types';
import { EngineAPI, ProcessInstanceDTO } from '@/api/engine';

interface SidebarProps {
  workflows: WorkflowFile[];
  activeWorkflowId: string;
  onSelectWorkflow: (id: string) => void;
  onAddNode: (type: NodeType) => void;
  onNewWorkflowModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  workflows,
  activeWorkflowId,
  onSelectWorkflow,
  onAddNode,
  onNewWorkflowModal,
}) => {
  const [activeTab, setActiveTab] = useState<'files' | 'palette' | 'instances'>('files');
  const [expandedFolder, setExpandedFolder] = useState<string>('all');
  
  const [instances, setInstances] = useState<ProcessInstanceDTO[]>([]);
  const [isLoadingInstances, setIsLoadingInstances] = useState<boolean>(false);

  React.useEffect(() => {
    if (activeTab === 'instances') {
      setIsLoadingInstances(true);
      EngineAPI.getInstances()
        .then(data => setInstances(data))
        .catch(err => console.error('Failed to fetch instances', err))
        .finally(() => setIsLoadingInstances(false));
    }
  }, [activeTab]);

  const paletteItems: {
    type: NodeType;
    title: string;
    description: string;
    icon: React.ElementType;
    color: string;
    bgColor: string;
    borderColor: string;
    glowClass?: string;
  }[] = [
    {
      type: 'agent',
      title: 'AI Agent Node',
      description: 'Autonomous LLM processing with confidence thresholds',
      icon: Bot,
      color: '#9D4EDD',
      bgColor: 'bg-[#9D4EDD]/10',
      borderColor: 'border-[#9D4EDD]/40',
      glowClass: 'glow-amethyst-subtle',
    },
    {
      type: 'human',
      title: 'Human Task Node',
      description: 'Escalation review, manual approval & SLA timer',
      icon: UserCheck,
      color: '#E76F51',
      bgColor: 'bg-[#E76F51]/10',
      borderColor: 'border-[#E76F51]/40',
    },
    {
      type: 'dmn',
      title: 'DMN Rule Table',
      description: 'Declarative policy decision matrix & hit rules',
      icon: Table,
      color: '#2A9D8F',
      bgColor: 'bg-[#2A9D8F]/10',
      borderColor: 'border-[#2A9D8F]/40',
    },
    {
      type: 'gateway',
      title: 'Exclusive Gateway',
      description: 'Logic branch based on agent output or risk score',
      icon: GitFork,
      color: '#F4A261',
      bgColor: 'bg-[#F4A261]/10',
      borderColor: 'border-[#F4A261]/40',
    },
    {
      type: 'event',
      title: 'Start / End Event',
      description: 'Webhook trigger, timer or workflow completion',
      icon: Circle,
      color: '#F4A261',
      bgColor: 'bg-[#F4A261]/10',
      borderColor: 'border-[#F4A261]/40',
    },
  ];

  return (
    <aside className="w-64 bg-[#25201D] border-r border-[#3A322E] flex flex-col h-full z-10 shrink-0">
      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-[#3A322E] bg-[#1A1614]/60 p-1">
        <button
          onClick={() => setActiveTab('files')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'files'
              ? 'bg-[#25201D] text-[#EAE3D9] shadow-warm-md border border-[#3A322E]'
              : 'text-[#A89F91] hover:text-[#EAE3D9]'
          }`}
        >
          <Folder className="w-3.5 h-3.5 text-[#F4A261]" />
          <span>Processes</span>
        </button>
        <button
          onClick={() => setActiveTab('palette')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'palette'
              ? 'bg-[#25201D] text-[#EAE3D9] shadow-warm-md border border-[#3A322E]'
              : 'text-[#A89F91] hover:text-[#EAE3D9]'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-[#9D4EDD]" />
          <span>Palette</span>
        </button>
        <button
          onClick={() => setActiveTab('instances')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'instances'
              ? 'bg-[#25201D] text-[#EAE3D9] shadow-warm-md border border-[#3A322E]'
              : 'text-[#A89F91] hover:text-[#EAE3D9]'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-[#2A9D8F]" />
          <span>Instances</span>
        </button>
      </div>

      {/* Files Navigator Tab */}
      {activeTab === 'files' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-[#A89F91] uppercase">
              Workflow Files
            </span>
            <button
              onClick={onNewWorkflowModal}
              className="text-xs text-[#F4A261] hover:text-[#f5ad73] p-1 rounded hover:bg-[#1A1614] transition-all flex items-center gap-1"
              title="Add New Process File"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1">
            {workflows.map((wf) => {
              const isActive = wf.id === activeWorkflowId;
              return (
                <button
                  key={wf.id}
                  onClick={() => onSelectWorkflow(wf.id)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all group flex items-start gap-2.5 ${
                    isActive
                      ? 'bg-[#1A1614] border-[#F4A261]/50 text-[#EAE3D9] shadow-warm-md'
                      : 'bg-[#25201D] hover:bg-[#2F2926] border-[#3A322E] text-[#A89F91] hover:text-[#EAE3D9]'
                  }`}
                >
                  <FileText className={`w-4 h-4 mt-0.5 shrink-0 ${isActive ? 'text-[#F4A261]' : 'text-[#A89F91]'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium truncate group-hover:text-[#EAE3D9]">
                        {wf.name}
                      </span>
                      {isActive && (
                        <span className="w-2 h-2 rounded-full bg-[#F4A261] shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[10px] text-[#A89F91]">
                      <span className="capitalize flex items-center gap-1.5">
                        <span className="capitalize">{wf.category}</span>
                        <span
                          className={`font-mono px-1 py-px rounded border ${
                            getRuntimeStatusTag(wf.fileType) === 'APL Native'
                              ? 'text-[#2A9D8F] border-[#2A9D8F]/30 bg-[#2A9D8F]/10'
                              : 'text-[#F4A261] border-[#F4A261]/30 bg-[#F4A261]/10'
                          }`}
                          title={getRuntimeStatusTag(wf.fileType)}
                        >
                          {getFileFormatLabel(wf.fileType)}
                        </span>
                      </span>
                      <span>v{wf.version}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-3 border-t border-[#3A322E]">
            <span className="text-[11px] font-semibold tracking-wider text-[#A89F91] uppercase block mb-2">
              Process Governance
            </span>
            <div className="p-3 bg-[#1A1614] rounded-xl border border-[#3A322E] space-y-2 text-xs">
              <div className="flex justify-between text-[#A89F91]">
                <span>Global Engine</span>
                <span className="text-[#90A955]">v3.6-BPMN</span>
              </div>
              <div className="flex justify-between text-[#A89F91]">
                <span>DMN Parser</span>
                <span className="text-[#2A9D8F]">Strict Hit Mode</span>
              </div>
              <div className="flex justify-between text-[#A89F91]">
                <span>Human SLA Alert</span>
                <span className="text-[#E76F51]">Enabled</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Node Palette Tab */}
      {activeTab === 'palette' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="text-[11px] font-semibold tracking-wider text-[#A89F91] uppercase mb-1">
            Drag or Click to Add Node
          </div>

          {paletteItems.map((item) => {
            const IconComponent = item.icon;
            return (
              <div
                key={item.type}
                onClick={() => onAddNode(item.type)}
                className={`p-3 rounded-xl border ${item.borderColor} ${item.bgColor} hover:scale-[1.02] cursor-pointer transition-all ${item.glowClass || ''} group`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${item.color}20`, color: item.color }}
                  >
                    <IconComponent className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-[#EAE3D9] group-hover:text-white">
                    {item.title}
                  </span>
                </div>
                <p className="text-[11px] text-[#A89F91] leading-relaxed">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Instances Tab */}
      {activeTab === 'instances' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-[#A89F91] uppercase">
              Live Executions
            </span>
            <button
              onClick={() => {
                setIsLoadingInstances(true);
                EngineAPI.getInstances().then(setInstances).finally(() => setIsLoadingInstances(false));
              }}
              className="text-xs text-[#2A9D8F] hover:text-[#34bdae] p-1 rounded hover:bg-[#1A1614] transition-all"
              title="Refresh Instances"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isLoadingInstances ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="space-y-2">
            {instances.length === 0 && !isLoadingInstances && (
              <div className="text-xs text-[#A89F91] text-center p-4 bg-[#1A1614] rounded-xl border border-[#3A322E]">
                No running instances found. Deploy and start a process to see it here.
              </div>
            )}
            {instances.map((instance) => (
              <div
                key={instance.id}
                className="w-full text-left p-2.5 rounded-xl border transition-all bg-[#25201D] hover:bg-[#2F2926] border-[#3A322E]"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[#EAE3D9] truncate">
                    {instance.processDefinitionId.split(':')[0]}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    instance.status === 'ACTIVE' ? 'bg-[#90A955]/10 text-[#90A955] border border-[#90A955]/30' :
                    instance.status === 'COMPLETED' ? 'bg-[#9D4EDD]/10 text-[#9D4EDD] border border-[#9D4EDD]/30' :
                    'bg-[#E76F51]/10 text-[#E76F51] border border-[#E76F51]/30'
                  }`}>
                    {instance.status}
                  </span>
                </div>
                <div className="flex justify-between text-[10px] text-[#A89F91] font-mono">
                  <span>ID: {instance.id.substring(0, 8)}...</span>
                  <span>{new Date(instance.startDate).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer System Status */}
      <div className="p-3 border-t border-[#3A322E] bg-[#1A1614]/80 text-[11px] text-[#A89F91] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#90A955]" />
          <span>Gemini AI Engine Online</span>
        </div>
        <span className="font-mono text-[10px] text-[#9D4EDD]">v2.4</span>
      </div>
    </aside>
  );
};
