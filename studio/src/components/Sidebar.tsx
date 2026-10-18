import React, { useState } from 'react';
import { FolderTree, ChevronDown, Layers, Activity, RotateCcw } from 'lucide-react';
import { WorkflowFile } from '@/types';
import { EngineAPI, ProcessDefinitionDTO, ProcessInstanceDTO, EngineInfoResponse } from '@/api/engine';
import { ProjectExplorer } from '@/components/ProjectExplorer';
import { NodePalette } from '@/components/NodePalette';
import type { NodeKind } from '@/features/designer/nodes/nodeCatalog';

interface SidebarProps {
  workflows: WorkflowFile[];
  activeWorkflowId: string;
  onSelectWorkflow: (id: string) => void;
  onActivateWorkflow: (workflow: WorkflowFile) => void;
  onRemoveDocument: (documentId: string) => void;
  onAddNode: (kind: NodeKind) => void;
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
  const [engineInfo, setEngineInfo] = useState<EngineInfoResponse | null>(null);
  const [engineInfoError, setEngineInfoError] = useState<boolean>(false);

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

  React.useEffect(() => {
    EngineAPI.getInfo()
      .then(info => {
        setEngineInfo(info);
        setEngineInfoError(false);
      })
      .catch(() => setEngineInfoError(true));
  }, []);

  const visibleInstances = processFilter === 'ALL'
    ? instances
    : instances.filter((instance) => instance.processDefinitionId === processFilter);

  return (
    <aside className="w-full min-w-0 bg-mocha border-r border-hairline flex flex-col h-full z-10">
      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-hairline bg-charcoal/60 p-1">
        <button
          onClick={() => onTabChange('files')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'files'
              ? 'bg-mocha text-linen shadow-warm-md border border-hairline'
              : 'text-sand hover:text-linen'
          }`}
        >
          <FolderTree className="w-3.5 h-3.5 text-saffron" />
          <span>Project</span>
        </button>
        <button
          onClick={() => onTabChange('palette')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'palette'
              ? 'bg-mocha text-linen shadow-warm-md border border-hairline'
              : 'text-sand hover:text-linen'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-amethyst" />
          <span>Palette</span>
        </button>
        <button
          onClick={() => onTabChange('instances')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'instances'
              ? 'bg-mocha text-linen shadow-warm-md border border-hairline'
              : 'text-sand hover:text-linen'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-mineral-teal" />
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
            <div className="text-xs text-sand text-center p-4 bg-charcoal rounded-xl border border-hairline">
              Open a project to browse its files.
            </div>
          )}

          <div className="pt-3 border-t border-hairline">
            <span className="text-[11px] font-semibold tracking-wider text-sand uppercase block mb-2">
              Engine Info
            </span>
            {engineInfoError ? (
              <div className="p-3 bg-charcoal rounded-xl border border-hairline text-xs text-desert-rose">
                Engine unreachable
              </div>
            ) : engineInfo ? (
              <div className="p-3 bg-charcoal rounded-xl border border-hairline space-y-2 text-xs">
                <div className="flex justify-between text-sand">
                  <span>Version</span>
                  <span className="text-sage-green">{engineInfo.version}</span>
                </div>
                <div className="flex justify-between text-sand">
                  <span>Standard</span>
                  <span className="text-mineral-teal">{engineInfo.engine.standard}</span>
                </div>
                <div className="flex justify-between text-sand">
                  <span>Persistence</span>
                  <span className="text-amethyst">{engineInfo.engine.persistence}</span>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-charcoal rounded-xl border border-hairline text-xs text-sand">
                Loading engine info...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Node Palette Tab */}
      {activeTab === 'palette' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="text-[11px] font-semibold tracking-wider text-sand uppercase mb-1">
            Nodes
          </div>
          <NodePalette onAddNode={onAddNode} />
        </div>
      )}

      {/* Instances Tab */}
      {activeTab === 'instances' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-sand uppercase">
              Live Executions
            </span>
            <button
              onClick={() => {
                setIsLoadingInstances(true);
                EngineAPI.getInstances(projectId).then(page => setInstances(page.items)).finally(() => setIsLoadingInstances(false));
              }}
              className="text-xs text-mineral-teal hover:text-mineral-teal-bright p-1 rounded hover:bg-charcoal transition-all"
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
                className="w-full appearance-none bg-charcoal border border-hairline rounded-lg px-2.5 py-1.5 text-[11px] text-sand focus:outline-none focus:border-saffron transition-colors"
                title="Filter instances by process"
              >
                <option value="ALL">All processes</option>
                {definitions.map((definition) => (
                  <option key={`${definition.id}-${definition.deploymentId}`} value={definition.id}>
                    {definition.name || definition.id} · v{definition.version}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sand" />
            </div>
          )}

          {processFilter !== 'ALL' && (
            <div className="text-[10px] text-sand">
              {visibleInstances.length} of {instances.length} instances
            </div>
          )}

          <div className="space-y-2">
            {visibleInstances.length === 0 && !isLoadingInstances && (
              <div className="text-xs text-sand text-center p-4 bg-charcoal rounded-xl border border-hairline">
                {processFilter === 'ALL'
                  ? 'No running instances found. Deploy and start a process to see it here.'
                  : 'No instances for this process yet. Deploy and start it to see them here.'}
              </div>
            )}
            {visibleInstances.map((instance) => (
              <button
                key={instance.id}
                onClick={() => onSelectInstance(instance)}
                className={`w-full text-left p-2.5 rounded-xl border transition-all hover:bg-mocha-hover ${
                  selectedInstanceId === instance.id
                    ? 'bg-charcoal border-mineral-teal/60'
                    : 'bg-mocha border-hairline'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-linen truncate">
                    {instance.processDefinitionId.split(':')[0]}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    instance.status === 'ACTIVE' || instance.status === 'RUNNING' ? 'bg-sage-green/10 text-sage-green border border-sage-green/30' :
                    instance.status === 'COMPLETED' ? 'bg-amethyst/10 text-amethyst border border-amethyst/30' :
                    'bg-desert-rose/10 text-desert-rose border border-desert-rose/30'
                  }`}>
                    {instance.status}
                  </span>
                </div>
                <div className="flex justify-between text-[10px] text-sand font-mono">
                  <span>ID: {instance.id.substring(0, 8)}...</span>
                  <span>{new Date(instance.startDate).toLocaleTimeString()}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Footer System Status */}
      <div className="p-3 border-t border-hairline bg-charcoal/80 text-[11px] text-sand flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-sage-green" />
          <span>APL Native Studio</span>
        </div>
        <span className="font-mono text-[10px] text-mineral-teal">abada.io/v1</span>
      </div>
    </aside>
  );
};
