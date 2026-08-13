import React, { useState } from 'react';
import { 
  FolderTree,
  Bot, 
  UserCheck, 
  GitFork, 
  GitMerge,
  SlidersHorizontal, 
  PlayCircle, 
  ChevronRight, 
  ChevronDown,
  Layers,
  Table,
  Zap,
  Terminal,
  CirclePlay,
  Flag,
  Mail,
  Clock,
  Radio,
  Activity,
  RotateCcw
} from 'lucide-react';
import { WorkflowFile, NodeType, EventSubtype, GatewaySubtype } from '@/types';
import { EngineAPI, ProcessDefinitionDTO, ProcessInstanceDTO } from '@/api/engine';
import { ProjectExplorer } from '@/components/ProjectExplorer';

interface SidebarProps {
  workflows: WorkflowFile[];
  activeWorkflowId: string;
  onSelectWorkflow: (id: string) => void;
  onActivateWorkflow: (workflow: WorkflowFile) => void;
  onRemoveDocument: (documentId: string) => void;
  onAddNode: (type: NodeType, subtype?: EventSubtype | GatewaySubtype) => void;
  onNewWorkflowModal: () => void;
  projectId?: string;
  activeTab: 'files' | 'palette' | 'instances';
  onTabChange: (tab: 'files' | 'palette' | 'instances') => void;
  selectedInstanceId?: string;
  onSelectInstance: (instance: ProcessInstanceDTO) => void;
  instancesRefreshKey?: number;
  treeRefreshKey?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  workflows,
  activeWorkflowId,
  onSelectWorkflow,
  onActivateWorkflow,
  onRemoveDocument,
  onAddNode,
  onNewWorkflowModal,
  projectId,
  activeTab,
  onTabChange,
  selectedInstanceId,
  onSelectInstance,
  instancesRefreshKey = 0,
  treeRefreshKey = 0,
}) => {
  const [instances, setInstances] = useState<ProcessInstanceDTO[]>([]);
  const [isLoadingInstances, setIsLoadingInstances] = useState<boolean>(false);
  const [definitions, setDefinitions] = useState<ProcessDefinitionDTO[]>([]);
  const [processFilter, setProcessFilter] = useState<string>('ALL');

  React.useEffect(() => {
    if (activeTab !== 'instances') return;
    if (!projectId) {
      setInstances([]);
      setDefinitions([]);
      return;
    }
    setIsLoadingInstances(true);
    EngineAPI.getInstances(projectId)
      .then(page => setInstances(page.items))
      .catch(err => console.error('Failed to fetch instances', err))
      .finally(() => setIsLoadingInstances(false));
    EngineAPI.getProcessDefinitions(projectId)
      .then(items => {
        const latestByKey = new Map<string, ProcessDefinitionDTO>();
        for (const item of items) {
          const current = latestByKey.get(item.id);
          if (!current || item.version > current.version) latestByKey.set(item.id, item);
        }
        setDefinitions([...latestByKey.values()].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => setDefinitions([]));
  }, [activeTab, instancesRefreshKey, projectId]);

  const visibleInstances = processFilter === 'ALL'
    ? instances
    : instances.filter((instance) => instance.processDefinitionId === processFilter);

  const paletteItems: {
    type: NodeType;
    subtype?: EventSubtype | GatewaySubtype;
    group: string;
    title: string;
    description: string;
    icon: React.ElementType;
    color: string;
    bgColor: string;
    borderColor: string;
    glowClass?: string;
  }[] = [
    {
      type: 'event',
      subtype: 'start',
      group: 'Events',
      title: 'Start Event',
      description: 'Webhook trigger that begins the APL process',
      icon: CirclePlay,
      color: '#F4A261',
      bgColor: 'bg-[#F4A261]/10',
      borderColor: 'border-[#F4A261]/40',
    },
    {
      type: 'event',
      subtype: 'end',
      group: 'Events',
      title: 'End Event',
      description: 'Terminal node — workflow completion',
      icon: Flag,
      color: '#F4A261',
      bgColor: 'bg-[#F4A261]/10',
      borderColor: 'border-[#F4A261]/40',
    },
    {
      type: 'event',
      subtype: 'message',
      group: 'Events',
      title: 'Message Catch',
      description: 'Durable subscription, correlated against correlationKey',
      icon: Mail,
      color: '#F4A261',
      bgColor: 'bg-[#F4A261]/10',
      borderColor: 'border-[#F4A261]/40',
    },
    {
      type: 'event',
      subtype: 'timer',
      group: 'Events',
      title: 'Timer Catch',
      description: 'Durable duration timer — resumes via the job scheduler',
      icon: Clock,
      color: '#F4A261',
      bgColor: 'bg-[#F4A261]/10',
      borderColor: 'border-[#F4A261]/40',
    },
    {
      type: 'event',
      subtype: 'signal',
      group: 'Events',
      title: 'Signal Catch',
      description: 'Durable broadcast signal subscription',
      icon: Radio,
      color: '#F4A261',
      bgColor: 'bg-[#F4A261]/10',
      borderColor: 'border-[#F4A261]/40',
    },
    {
      type: 'agent',
      group: 'Activities',
      title: 'AI Agent Node',
      description: 'Autonomous LLM processing with confidence thresholds',
      icon: Bot,
      color: '#9D4EDD',
      bgColor: 'bg-[#9D4EDD]/10',
      borderColor: 'border-[#9D4EDD]/40',
      glowClass: 'glow-amethyst-subtle',
    },
    {
      type: 'engine-task',
      group: 'Activities',
      title: 'Engine Task',
      description: 'Durable external job on a declared service topic',
      icon: Zap,
      color: '#90A955',
      bgColor: 'bg-[#90A955]/10',
      borderColor: 'border-[#90A955]/40',
    },
    {
      type: 'script',
      group: 'Activities',
      title: 'Script Step',
      description: 'In-transaction server-side script (embedded delegate form)',
      icon: Terminal,
      color: '#2A9D8F',
      bgColor: 'bg-[#2A9D8F]/10',
      borderColor: 'border-[#2A9D8F]/40',
    },
    {
      type: 'human',
      group: 'Activities',
      title: 'Approval Gate',
      description: 'Human review, escalation & SLA timer',
      icon: UserCheck,
      color: '#E76F51',
      bgColor: 'bg-[#E76F51]/10',
      borderColor: 'border-[#E76F51]/40',
    },
    {
      type: 'dmn',
      group: 'Decisions & Routing',
      title: 'DMN Rule Table',
      description: 'Declarative policy decision matrix & hit rules',
      icon: Table,
      color: '#2A9D8F',
      bgColor: 'bg-[#2A9D8F]/10',
      borderColor: 'border-[#2A9D8F]/40',
    },
    {
      type: 'gateway',
      subtype: 'exclusive',
      group: 'Decisions & Routing',
      title: 'Exclusive Gateway',
      description: 'Conditional branch on instance variables',
      icon: GitFork,
      color: '#F4A261',
      bgColor: 'bg-[#F4A261]/10',
      borderColor: 'border-[#F4A261]/40',
    },
    {
      type: 'gateway',
      subtype: 'parallel',
      group: 'Decisions & Routing',
      title: 'Parallel Gateway',
      description: 'Fork every branch concurrently, join on all arrivals',
      icon: GitMerge,
      color: '#F4A261',
      bgColor: 'bg-[#F4A261]/10',
      borderColor: 'border-[#F4A261]/40',
    },
    {
      type: 'gateway',
      subtype: 'inclusive',
      group: 'Decisions & Routing',
      title: 'Inclusive Gateway',
      description: 'Fork every matching branch, zero-matches need an else flow',
      icon: GitMerge,
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
          onClick={() => onTabChange('files')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'files'
              ? 'bg-[#25201D] text-[#EAE3D9] shadow-warm-md border border-[#3A322E]'
              : 'text-[#A89F91] hover:text-[#EAE3D9]'
          }`}
        >
          <FolderTree className="w-3.5 h-3.5 text-[#F4A261]" />
          <span>Project</span>
        </button>
        <button
          onClick={() => onTabChange('palette')}
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
          onClick={() => onTabChange('instances')}
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
          {projectId ? (
            <ProjectExplorer
              projectId={projectId}
              activeWorkflowId={activeWorkflowId}
              workflows={workflows}
              onSelectWorkflow={onSelectWorkflow}
              onActivateWorkflow={onActivateWorkflow}
              onRemoveDocument={onRemoveDocument}
              onNewWorkflow={onNewWorkflowModal}
              refreshKey={treeRefreshKey}
            />
          ) : (
            <div className="text-xs text-[#A89F91] text-center p-4 bg-[#1A1614] rounded-xl border border-[#3A322E]">
              Open a project to browse its files.
            </div>
          )}

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
            APL Node Palette
          </div>

          {paletteItems.map((item) => {
            const IconComponent = item.icon;
            const previousItem = paletteItems[paletteItems.indexOf(item) - 1];
            return (
              <React.Fragment key={`${item.type}-${item.subtype || ''}`}>
                {(!previousItem || previousItem.group !== item.group) && (
                  <div className="text-[10px] font-semibold tracking-wider text-[#A89F91]/80 uppercase pt-2 first:pt-0">
                    {item.group}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onAddNode(item.type, item.subtype)}
                  className={`w-full text-left p-3 rounded-xl border ${item.borderColor} ${item.bgColor} hover:scale-[1.02] cursor-pointer transition-all ${item.glowClass || ''} group`}
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
                </button>
              </React.Fragment>
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
                EngineAPI.getInstances(projectId).then(page => setInstances(page.items)).finally(() => setIsLoadingInstances(false));
              }}
              className="text-xs text-[#2A9D8F] hover:text-[#34bdae] p-1 rounded hover:bg-[#1A1614] transition-all"
              title="Refresh Instances"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isLoadingInstances ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {definitions.length > 0 && (
            <div className="relative">
              <select
                value={processFilter}
                onChange={(event) => setProcessFilter(event.target.value)}
                className="w-full appearance-none bg-[#1A1614] border border-[#3A322E] rounded-lg px-2.5 py-1.5 text-[11px] text-[#A89F91] focus:outline-none focus:border-[#F4A261] transition-colors"
                title="Filter instances by process"
              >
                <option value="ALL">All processes</option>
                {definitions.map((definition) => (
                  <option key={`${definition.id}-${definition.deploymentId}`} value={definition.id}>
                    {definition.name || definition.id} · v{definition.version}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A89F91]" />
            </div>
          )}

          {processFilter !== 'ALL' && (
            <div className="text-[10px] text-[#A89F91]">
              {visibleInstances.length} of {instances.length} instances
            </div>
          )}

          <div className="space-y-2">
            {visibleInstances.length === 0 && !isLoadingInstances && (
              <div className="text-xs text-[#A89F91] text-center p-4 bg-[#1A1614] rounded-xl border border-[#3A322E]">
                {processFilter === 'ALL'
                  ? 'No running instances found. Deploy and start a process to see it here.'
                  : 'No instances for this process yet. Deploy and start it to see them here.'}
              </div>
            )}
            {visibleInstances.map((instance) => (
              <button
                key={instance.id}
                onClick={() => onSelectInstance(instance)}
                className={`w-full text-left p-2.5 rounded-xl border transition-all hover:bg-[#2F2926] ${
                  selectedInstanceId === instance.id
                    ? 'bg-[#1A1614] border-[#2A9D8F]/60'
                    : 'bg-[#25201D] border-[#3A322E]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[#EAE3D9] truncate">
                    {instance.processDefinitionId.split(':')[0]}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    instance.status === 'ACTIVE' || instance.status === 'RUNNING' ? 'bg-[#90A955]/10 text-[#90A955] border border-[#90A955]/30' :
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
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Footer System Status */}
      <div className="p-3 border-t border-[#3A322E] bg-[#1A1614]/80 text-[11px] text-[#A89F91] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#90A955]" />
          <span>APL Native Studio</span>
        </div>
        <span className="font-mono text-[10px] text-[#2A9D8F]">abada.io/v1</span>
      </div>
    </aside>
  );
};
