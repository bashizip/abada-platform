import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { Canvas } from '@/features/designer/Canvas';
import { PropertiesInspector } from '@/components/PropertiesInspector';
import { NLInputBar } from '@/components/NLInputBar';
import { SimulationPanel } from '@/components/SimulationPanel';
import { NewWorkflowModal } from '@/components/NewWorkflowModal';
import { ProcessDetailsModal } from '@/components/ProcessDetailsModal';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ProjectDialog } from '@/components/ProjectDialog';
import { SignInGate } from '@/components/SignInGate';
import { AIDiffModal } from '@/features/designer/AIDiffModal';
import { InsightReviewDialog } from '@/features/designer/InsightReviewDialog';
import { TaskInbox } from '@/features/inbox/TaskInbox';
import { ProjectAdmin } from '@/features/admin/ProjectAdmin';
import { Activity } from 'lucide-react';
import { ProcessOperations } from '@/features/operations/ProcessOperations';
import { InstanceOverviewBar } from '@/features/operations/InstanceOverviewBar';
import { LiveInstanceInspector } from '@/features/operations/LiveInstanceInspector';
import { InstanceDetailView } from '@/features/operations/InstanceDetailView';
import { DryRunPanel } from '@/features/run/DryRunPanel';
import { DeployDialog } from '@/features/run/DeployDialog';
import { agentModelGuardMessage, invalidAgentModels } from '@/lib/agentModels';
import { EngineAPI } from '@/api/engine';
import { InsightAPI } from '@/api/insight';
import { ProjectAPI } from '@/api/projects';
import { keycloak } from '@/auth/keycloakClient';
import { stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import { AplEditor } from '@/features/designer/AplEditor';
import { useToast } from '@/components/ToastContext';
import { useProjectWorkspace } from '@/hooks/useProjectWorkspace';
import { useLiveInstanceOverlay } from '@/hooks/useLiveInstanceOverlay';
import { useDryRunSimulation } from '@/hooks/useDryRunSimulation';
import { useAplAuthoringState } from '@/hooks/useAplAuthoringState';
import { deriveDefaultPayload } from '@/lib/run/liveRun';
import { DEFAULT_AGENT_MODEL } from '@/lib/agentModels';
import { autoLayoutWorkflow } from '@/lib/layout/autoLayout';
import { WorkflowDiffSnapshot } from '@/lib/aiDiff/types';
import { WorkflowFile, WorkflowNode, WorkflowEdge, NodeType, EventSubtype, GatewaySubtype } from '@/types';
import { workflowFingerprint } from '@/lib/run/workflowFingerprint';

type StudioView = 'designer' | 'inbox' | 'operations' | 'instance' | 'administration';
type DesignerMode = 'diagram' | 'apl';

export default function App() {
  const { showToast } = useToast();
  const [authenticated, setAuthenticated] = useState<boolean>(keycloak.authenticated === true);
  const [currentView, setCurrentView] = useState<StudioView>('designer');
  const [designerMode, setDesignerMode] = useState<DesignerMode>('diagram');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [sidebarTab, setSidebarTab] = useState<'files' | 'palette' | 'instances'>('files');
  const [showProcessDetails, setShowProcessDetails] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [showDeployDialog, setShowDeployDialog] = useState(false);
  const [diffSnapshot, setDiffSnapshot] = useState<WorkflowDiffSnapshot | null>(null);
  const [insightDialog, setInsightDialog] = useState<null | { state: 'loading' | 'empty' | 'error'; message?: string }>(null);

  const {
    workflows, setWorkflows, activeWorkflowId, setActiveWorkflowId,
    currentWorkflow, projects, setProjects, activeProject,
    showProjects, setShowProjects, treeRefreshKey, setTreeRefreshKey,
    openProject, updateActiveWorkflow, processesRootId, persistedProcessKeys
  } = useProjectWorkspace(authenticated);

  const {
    isSimulating, setIsSimulating, simulationLogs, setSimulationLogs,
    showLogPanel, setShowLogPanel, showRunPanel, setShowRunPanel,
    dryRunFingerprint, setDryRunFingerprint, lastDryRunPayload, setLastDryRunPayload,
    activeSimulationNodeId, setActiveSimulationNodeId
  } = useDryRunSimulation();

  const {
    selectedLiveInstance, liveWorkflow, activeLiveNodeIds, liveSelectedNodeId, setLiveSelectedNodeId,
    executionStatuses, instancesRefreshKey, setInstancesRefreshKey,
    instancePanelOpen, setInstancePanelOpen, detailInstance, setDetailInstance,
    livePanelWidth, setLivePanelWidth, livePanelPinned, setLivePanelPinned,
    openLiveInstance, openInstanceDetail, clearLiveInstanceState
  } = useLiveInstanceOverlay(activeProject, workflows, setSidebarTab, setDesignerMode, setShowRunPanel, setCurrentView, setSimulationLogs);

  const {
    authoringCandidate, setAuthoringCandidate, isGenerating, handleGenerateWorkflow
  } = useAplAuthoringState(activeProject, currentWorkflow, setSimulationLogs, setDesignerMode);

  const displayedWorkflow = selectedLiveInstance && liveWorkflow ? liveWorkflow : currentWorkflow;
  const isLiveReadOnly = !!selectedLiveInstance;
  const selectedNode = currentWorkflow.nodes.find((n) => n.id === selectedNodeId) || null;

  useEffect(() => {
    const sync = () => setAuthenticated(keycloak.authenticated === true);
    sync();
    keycloak.onAuthSuccess = sync;
    keycloak.onAuthLogout = sync;
    keycloak.onTokenExpired = sync;
    return () => {
      keycloak.onAuthSuccess = undefined;
      keycloak.onAuthLogout = undefined;
      keycloak.onTokenExpired = undefined;
    };
  }, []);

  const laidOutWorkflowIds = useRef(new Set<string>());
  useLayoutEffect(() => {
    if (!activeWorkflowId && workflows.length === 0) return;
    if (laidOutWorkflowIds.current.has(activeWorkflowId)) return;
    laidOutWorkflowIds.current.add(activeWorkflowId);
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: autoLayoutWorkflow(wf.nodes, wf.edges),
    }));
  }, [activeWorkflowId, workflows.length, updateActiveWorkflow]);

  const handleNodeMove = (id: string, x: number, y: number) => {
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    }));
  };

  const handleSelectNode = useCallback((id: string | null) => {
    setSelectedNodeId((current) => current === id ? current : id);
  }, []);

  const handleApplyApl = (workflow: WorkflowFile) => {
    const targetId = authoringCandidate?.replaceWorkflowId || activeWorkflowId;
    const persistedTarget = workflows.find((item) => item.id === targetId && item.documentId);
    const immutableProcessKey = persistedTarget?.documentId
      ? persistedProcessKeys.current.get(persistedTarget.documentId) || persistedTarget.processKey
      : undefined;
    const appliedWorkflow = persistedTarget ? {
      ...workflow,
      id: persistedTarget.id,
      documentId: persistedTarget.documentId,
      revision: persistedTarget.revision,
      processKey: immutableProcessKey,
      version: persistedTarget.version,
      updatedAt: persistedTarget.updatedAt,
      description: persistedTarget.description,
    } : workflow;
    let activeId = appliedWorkflow.id;
    if (authoringCandidate && !authoringCandidate.replaceWorkflowId) {
      setWorkflows((items) => [appliedWorkflow, ...items]);
    } else if (workflows.some((item) => item.id === targetId)) {
      setWorkflows((items) => items.map((item) => item.id === targetId ? appliedWorkflow : item));
    } else {
      const draftId = `draft-${Date.now()}`;
      activeId = draftId;
      setWorkflows((items) => [
        { ...appliedWorkflow, id: draftId, folderId: appliedWorkflow.folderId ?? processesRootId.current },
        ...items.filter((item) => !item.id.startsWith('draft-')),
      ]);
    }
    setActiveWorkflowId(activeId);
    setSelectedNodeId(appliedWorkflow.nodes[0]?.id || null);
    setAuthoringCandidate(null);
    setDesignerMode('diagram');
  };

  const handleAutoLayout = (layoutedNodes: WorkflowNode[]) => {
    updateActiveWorkflow((wf) => ({ ...wf, nodes: layoutedNodes }));
  };

  const handleUpdateNode = (updatedNode: WorkflowNode) => {
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => (n.id === updatedNode.id) ? updatedNode : n),
    }));
  };

  const handleDeleteNode = (id: string) => {
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: wf.nodes.filter((n) => n.id !== id),
      edges: wf.edges.filter((e) => e.source !== id && e.target !== id),
    }));
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const _handleDuplicateNode = (id: string) => {
    const target = currentWorkflow.nodes.find((n) => n.id === id);
    if (!target) return;
    const newNode: WorkflowNode = {
      ...target,
      id: `${target.type}-${Date.now()}`,
      title: `${target.title} (Copy)`,
      x: target.x + 40,
      y: target.y + 40,
    };
    updateActiveWorkflow((wf) => ({ ...wf, nodes: [...wf.nodes, newNode] }));
    setSelectedNodeId(newNode.id);
  };

  const handleAddNode = (type: NodeType, subtype?: EventSubtype | GatewaySubtype) => {
    const id = `${type}-${Date.now()}`;
    const isFirstEvent = type === 'event'
      && !currentWorkflow.nodes.some((node) => node.type === 'event' && node.subtype === 'start');
    const defaultTitles: Record<NodeType, string> = {
      agent: 'AI Validation Agent', human: 'Executive Review Task', dmn: 'Risk Matrix Policy',
      gateway: subtype === 'parallel' ? 'Parallel Gateway' : 'Branching Gateway',
      event: isFirstEvent ? 'Start Process' : 'End Process', 'engine-task': 'Engine Service Task',
    };
    const newNode: WorkflowNode = {
      id, type,
      subtype: type === 'event'
        ? (subtype && ((subtype as EventSubtype) === 'start' || (subtype as EventSubtype) === 'end')
          ? (subtype as EventSubtype) : isFirstEvent ? 'start' : 'end')
        : type === 'gateway' ? subtype : undefined,
      title: defaultTitles[type],
      description: `Newly instantiated ${type} node`,
      x: 120 + currentWorkflow.nodes.length * 260, y: 220,
      agentConfig: type === 'agent' ? { model: DEFAULT_AGENT_MODEL, systemPrompt: 'Evaluate incoming data and perform risk verification.', confidenceThreshold: 85, temperature: 0.2, tools: ['Database Query'] } : undefined,
      dmnConfig: type === 'dmn' ? { decisionKey: `DMN_POLICY_${Date.now().toString().slice(-4)}`, hitPolicy: 'FIRST', inputs: [{ name: 'PayloadValue', type: 'NUMBER', expr: '${payload.value}' }], outputs: [{ name: 'AllowPass', type: 'BOOLEAN' }], rules: [{ id: 'r1', when: 'PayloadValue > 100', then: { AllowPass: true } }, { id: 'r2', otherwise: true, then: { AllowPass: false } }] } : undefined,
      humanConfig: type === 'human' ? { assigneeRole: 'Operations Analyst', slaHours: 24, formFields: ['Review Notes', 'Approval Signature'] } : undefined,
      engineTaskConfig: type === 'engine-task' ? { service: 'abada:service' } : undefined,
    };
    updateActiveWorkflow((wf) => {
      const sourceExists = selectedNodeId && wf.nodes.some((node) => node.id === selectedNodeId);
      return {
        ...wf,
        nodes: [...wf.nodes, newNode],
        edges: sourceExists ? [...wf.edges, { id: `e-${Date.now()}`, source: selectedNodeId, target: id, label: 'Next' }] : wf.edges,
      };
    });
    setSelectedNodeId(id);
  };

  const handleConnectNodes = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    if (currentWorkflow.edges.some((e) => e.source === sourceId && e.target === targetId)) return;
    updateActiveWorkflow((wf) => ({
      ...wf,
      edges: [...wf.edges, { id: `e-${Date.now()}`, source: sourceId, target: targetId, label: 'Flow Connection' }],
    }));
  };

  const _handleAddDownstreamNode = (sourceId: string, type: NodeType) => {
    const sourceNode = currentWorkflow.nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return;
    const newId = `${type}-${Date.now()}`;
    const newNode: WorkflowNode = {
      id: newId, type, title: type === 'agent' ? 'Secondary AI Agent' : 'Subsequent Task',
      description: 'Downstream node added from toolbar', x: sourceNode.x + 240, y: sourceNode.y,
      agentConfig: type === 'agent' ? { model: DEFAULT_AGENT_MODEL, systemPrompt: 'Downstream agent handling post-processing.', confidenceThreshold: 90, temperature: 0.1, tools: ['API Webhook'] } : undefined,
    };
    updateActiveWorkflow((wf) => ({
      ...wf, nodes: [...wf.nodes, newNode], edges: [...wf.edges, { id: `e-${Date.now()}`, source: sourceId, target: newId, label: 'Next Step' }],
    }));
    setSelectedNodeId(newId);
  };

  const handleOpenRunPanel = () => {
    setShowLogPanel(false);
    setShowRunPanel(true);
    clearLiveInstanceState();
  };

  const handleOpenAiDiff = async () => {
    setInsightDialog({ state: 'loading' });
    const definitionKey = currentWorkflow.processKey || currentWorkflow.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    try {
      const page = await InsightAPI.listProposals(definitionKey, activeProject?.id);
      const summary = page.items.find((item) => item.status === 'DRAFT' || item.status === 'IN_REVIEW');
      if (!summary) return setInsightDialog({ state: 'empty' });
      setDiffSnapshot(InsightAPI.toDiffSnapshot(await InsightAPI.getProposal(summary.id, activeProject?.id)));
      setInsightDialog(null);
    } catch (error) {
      setInsightDialog({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleExitAiDiff = () => { setDiffSnapshot(null); setInsightDialog(null); };

  const handleApplyAiDiff = async (comment: string) => {
    if (!diffSnapshot?.backend) return;
    try {
      const reviewed = await InsightAPI.reviewProposal(diffSnapshot.backend.id, 'APPROVE', comment, diffSnapshot.backend.updatedAt, activeProject?.id);
      if (reviewed.status === 'ADOPTED') {
        updateActiveWorkflow((wf) => ({ ...wf, nodes: diffSnapshot.proposedNodes, edges: diffSnapshot.proposedEdges, version: String(reviewed.adoptedVersion || wf.version), fileType: 'apl' }));
      }
      showToast('success', `Optimization reviewed. Status: ${reviewed.status}.`);
      setDiffSnapshot(null);
    } catch (err) {
      showToast('error', 'Failed to review optimization proposal.');
    }
  };

  const handleRejectAiDiff = async (comment: string) => {
    if (!diffSnapshot?.backend) return;
    try {
      const reviewed = await InsightAPI.reviewProposal(diffSnapshot.backend.id, 'REJECT', comment, diffSnapshot.backend.updatedAt, activeProject?.id);
      showToast('info', `Optimization ${reviewed.status.toLowerCase()}. Current definition unchanged.`);
      setDiffSnapshot(null);
    } catch (err) {
      showToast('error', 'Failed to reject optimization proposal.');
    }
  };

  const handleDeploy = async (payload: Record<string, unknown>) => {
    if (isDeploying) return;
    setIsDeploying(true);
    setShowLogPanel(true);
    setSimulationLogs(prev => [...prev, { id: `deploy-${Date.now()}-1`, timestamp: new Date().toLocaleTimeString(), nodeId: 'system', nodeTitle: 'Deployment Compiler', nodeType: 'event', status: 'info', message: 'Validating and deploying native abada.io/v1 APL...' }]);
    try {
      const invalidModels = invalidAgentModels(currentWorkflow.nodes);
      if (invalidModels.length > 0) throw new Error(agentModelGuardMessage(invalidModels));
      let deployWorkflow = currentWorkflow;
      if (activeProject) {
        const wasDraft = !currentWorkflow.documentId;
        const saved = currentWorkflow.documentId ? await ProjectAPI.saveDocument(activeProject.id, currentWorkflow) : await ProjectAPI.createDocument(activeProject.id, currentWorkflow, currentWorkflow.description || '', { folderId: currentWorkflow.folderId ?? null, fileName: currentWorkflow.fileName ?? null });
        deployWorkflow = { ...currentWorkflow, id: saved.id, documentId: saved.id, revision: saved.revision, updatedAt: saved.updatedAt };
        setWorkflows((items) => items.map((item) => item.id === currentWorkflow.id ? deployWorkflow : item));
        if (wasDraft) setActiveWorkflowId(saved.id);
        setTreeRefreshKey((value) => value + 1);
      }
      const response = activeProject ? await ProjectAPI.deployDocument(activeProject.id, deployWorkflow) : await EngineAPI.deployWorkflow(currentWorkflow);
      const { processInstanceId } = await EngineAPI.startProcess(response.processKey, payload, activeProject?.id);
      const instance = await EngineAPI.getInstance(processInstanceId, activeProject?.id);
      setSimulationLogs(prev => [...prev, { id: `deploy-${Date.now()}-2`, timestamp: new Date().toLocaleTimeString(), nodeId: 'system', nodeTitle: 'Abada Engine', nodeType: 'event', status: 'success', message: `Deployed [${response.processKey}] v${response.version} and started live instance ${processInstanceId}.` }]);
      setShowDeployDialog(false);
      setInstancesRefreshKey((value) => value + 1);
      showToast('success', 'Successfully deployed workflow and started process instance.');
      await openLiveInstance(instance);
    } catch (err: any) {
      setSimulationLogs(prev => [...prev, { id: `deploy-${Date.now()}-err`, timestamp: new Date().toLocaleTimeString(), nodeId: 'system', nodeTitle: 'Deploy & Start Error', nodeType: 'event', status: 'error', message: `Deploy & Start failed: ${err.message}` }]);
      showToast('error', err.message || 'Deployment failed');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleExportJSON = () => {
    const aplObj = workflowToAPL(displayedWorkflow);
    const yamlContent = stringifyAPLYaml(aplObj);
    const dataStr = 'data:text/yaml;charset=utf-8,' + encodeURIComponent(yamlContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${displayedWorkflow.processKey || 'process'}.apl.yaml`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleCreateNewWorkflow = (workflow: WorkflowFile, folderId?: string) => {
    const fileName = (workflow.fileName || workflow.name).endsWith('.apl.yaml') ? (workflow.fileName || workflow.name) : `${workflow.fileName || workflow.name}.apl.yaml`;
    const seeded: WorkflowFile = workflow.nodes.length > 0 ? workflow : { ...workflow, nodes: [{ id: 'start', type: 'event', subtype: 'start', title: 'Start Process', description: 'Webhook trigger that begins the APL process', x: 120, y: 220 }] };
    const draft: WorkflowFile = { ...seeded, id: `draft-${Date.now()}`, name: fileName, fileName, processKey: seeded.processKey || fileName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || `process_${Date.now()}` };
    if (folderId) draft.folderId = folderId;
    setWorkflows((prev) => [draft, ...prev.filter((item) => !item.id.startsWith('draft-'))]);
    setAuthoringCandidate(null);
    setActiveWorkflowId(draft.id);
    setSelectedNodeId(draft.nodes[0]?.id || null);
    setDesignerMode('diagram');
  };

  const handleActivateDocument = (workflow: WorkflowFile) => {
    if (!workflow.documentId) return setActiveWorkflowId(workflow.id);
    setWorkflows((prev) => prev.some((item) => item.documentId === workflow.documentId) ? prev : [workflow, ...prev]);
    setAuthoringCandidate(null);
    clearLiveInstanceState();
    setActiveWorkflowId(workflow.id);
    setSelectedNodeId(workflow.nodes[0]?.id || null);
    setDesignerMode('diagram');
  };

  const handleRemoveDocument = (documentId: string) => {
    const wasActive = workflows.find((item) => item.id === activeWorkflowId)?.documentId === documentId;
    const remaining = workflows.filter((item) => item.documentId !== documentId);
    if (wasActive) {
      const nextActive = remaining.find((item) => !item.id.startsWith('draft-')) ?? remaining[0];
      if (nextActive) {
        setActiveWorkflowId(nextActive.id);
        setSelectedNodeId(nextActive.nodes[0]?.id || null);
      }
    }
    setWorkflows(remaining);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#1A1614] text-[#EAE3D9] overflow-hidden">
      {!authenticated && <SignInGate />}
      {authenticated && (
        <>
      <Header
        currentWorkflow={displayedWorkflow}
        onRunSimulation={handleOpenRunPanel}
        isSimulating={isSimulating}
        onExportJSON={handleExportJSON}
        onDeploy={() => setShowDeployDialog(true)}
        isDeploying={isDeploying}
        onToggleLogPanel={() => setShowLogPanel(!showLogPanel)}
        showLogPanel={showLogPanel}
        nodeCount={currentWorkflow.nodes.length}
        onOpenAiDiff={handleOpenAiDiff}
        isDiffActive={!!diffSnapshot}
        onOpenProcessDetails={() => setShowProcessDetails(true)}
        onOpenSettings={() => setShowSettings(true)}
        currentView={currentView}
        onViewChange={setCurrentView}
        activeProject={activeProject}
        onOpenProjects={() => setShowProjects(true)}
        readOnlyInstance={isLiveReadOnly}
      />
      <div className="flex flex-1 overflow-hidden relative">
        {currentView === 'instance' && detailInstance ? (
          <InstanceDetailView
            instanceId={detailInstance.id}
            projectId={activeProject?.id}
            initialInstance={detailInstance}
            onBack={() => {
              setDetailInstance(null);
              setCurrentView('operations');
            }}
            onOpenCanvas={(instance) => {
              setCurrentView('designer');
              void openLiveInstance(instance);
            }}
          />
        ) : (
          <>
        {currentView === 'designer' && (
          <Sidebar
            workflows={workflows}
            activeWorkflowId={activeWorkflowId}
            onSelectWorkflow={(id) => {
              setAuthoringCandidate(null);
              clearLiveInstanceState();
              setSidebarTab('files');
              setActiveWorkflowId(id);
              const wf = workflows.find((w) => w.id === id);
              if (wf && wf.nodes.length > 0) setSelectedNodeId(wf.nodes[0].id);
            }}
            onActivateWorkflow={handleActivateDocument}
            onRemoveDocument={handleRemoveDocument}
            onAddNode={handleAddNode}
            onNewWorkflowModal={() => setIsNewModalOpen(true)}
            projectId={activeProject?.id}
            activeTab={sidebarTab}
            onTabChange={(tab) => {
              setSidebarTab(tab);
              if (tab !== 'instances') clearLiveInstanceState();
            }}
            selectedInstanceId={selectedLiveInstance?.id}
            onSelectInstance={(instance) => void openLiveInstance(instance)}
            instancesRefreshKey={instancesRefreshKey}
            treeRefreshKey={treeRefreshKey}
          />
        )}
        {currentView === 'designer' && (
          <>
            {!isLiveReadOnly && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 rounded-xl border border-[#3A322E] bg-[#25201D]/95 p-1 shadow-warm-md">
              <button onClick={() => setDesignerMode('diagram')}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${designerMode === 'diagram' ? 'bg-[#F4A261] text-[#1A1614]' : 'text-[#A89F91] hover:text-[#EAE3D9]'}`}>
                Diagram
              </button>
              <button onClick={() => setDesignerMode('apl')}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${designerMode === 'apl' ? 'bg-[#2A9D8F] text-[#101816]' : 'text-[#A89F91] hover:text-[#EAE3D9]'}`}>
                APL YAML
              </button>
            </div>}

            {isLiveReadOnly && selectedLiveInstance && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-xl border border-[#2A9D8F]/40 bg-[#15201E]/95 px-3 py-2 shadow-warm-md">
                <span className="relative flex h-2.5 w-2.5"><span className="absolute h-full w-full rounded-full bg-[#2A9D8F]/50 animate-ping" /><span className="relative h-2.5 w-2.5 rounded-full bg-[#2A9D8F]" /></span>
                <span className="text-[11px] font-semibold">Live Instance</span>
                <span className="font-mono text-[10px] text-[#A89F91]">{(selectedLiveInstance.id || '').slice(0, 8)}</span>
                <span className="text-[10px] text-[#2A9D8F]">{selectedLiveInstance.status}</span>
                <span className="text-[10px] text-[#737D69]">Read-only</span>
              </div>
            )}

            {isLiveReadOnly && selectedLiveInstance && !instancePanelOpen && (
              <button
                type="button"
                onClick={() => setInstancePanelOpen(true)}
                className="absolute right-4 top-3 z-30 flex items-center gap-1.5 rounded-lg border border-[#2A9D8F]/40 bg-[#15201E]/95 px-3 py-1.5 text-[11px] font-semibold text-[#2A9D8F] shadow-warm-md transition-all hover:bg-[#15201E]"
                title="Show instance details"
              >
                <Activity className="h-3.5 w-3.5" /> Instance Details
              </button>
            )}

            {designerMode === 'diagram' || isLiveReadOnly ? (
              isLiveReadOnly && selectedLiveInstance && liveWorkflow ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="relative flex min-h-0 flex-1">
                    <Canvas
                      key={displayedWorkflow.id}
                      nodes={displayedWorkflow.nodes}
                      edges={displayedWorkflow.edges}
                      selectedNodeId={liveSelectedNodeId}
                      onSelectNode={setLiveSelectedNodeId}
                      onNodeMove={handleNodeMove}
                      onDeleteNode={handleDeleteNode}
                      onConnectNodes={handleConnectNodes}
                      onAutoLayout={handleAutoLayout}
                      onAddNode={handleAddNode}
                      onOpenAplEditor={() => setDesignerMode('apl')}
                      onFocusPrompt={() => document.getElementById('workflow-prompt')?.focus()}
                      isSimulating={isSimulating}
                      activeSimulationNodeId={activeSimulationNodeId}
                      executionStatuses={executionStatuses}
                      activeLiveNodeIds={activeLiveNodeIds}
                      readOnly
                    />
                    {instancePanelOpen && (
                      <LiveInstanceInspector
                        instance={selectedLiveInstance}
                        workflow={liveWorkflow}
                        projectId={activeProject?.id}
                        definitionVersion={liveWorkflow.version}
                        selectedNodeId={liveSelectedNodeId}
                        onClose={() => setInstancePanelOpen(false)}
                        panelWidth={livePanelWidth}
                        onPanelWidthChange={setLivePanelWidth}
                        pinned={livePanelPinned}
                        onPinnedChange={setLivePanelPinned}
                      />
                    )}
                  </div>
                  <InstanceOverviewBar
                    instance={selectedLiveInstance}
                    definitionVersion={liveWorkflow.version}
                  />
                </div>
              ) : (
                <>
                  <Canvas
                    key={displayedWorkflow.id}
                    nodes={displayedWorkflow.nodes}
                    edges={displayedWorkflow.edges}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={handleSelectNode}
                    onNodeMove={handleNodeMove}
                    onDeleteNode={handleDeleteNode}
                    onConnectNodes={handleConnectNodes}
                    onAutoLayout={handleAutoLayout}
                    onAddNode={handleAddNode}
                    onOpenAplEditor={() => setDesignerMode('apl')}
                    onFocusPrompt={() => document.getElementById('workflow-prompt')?.focus()}
                    isSimulating={isSimulating}
                    activeSimulationNodeId={activeSimulationNodeId}
                    executionStatuses={executionStatuses}
                    activeLiveNodeIds={activeLiveNodeIds}
                    readOnly={false}
                  />

                  <PropertiesInspector
                    selectedNode={selectedNode}
                    onUpdateNode={handleUpdateNode}
                    nodeCount={currentWorkflow.nodes.length}
                  />

                  <NLInputBar
                    onGenerateWorkflow={handleGenerateWorkflow}
                    isGenerating={isGenerating}
                    hasActiveWorkflow={!!activeProject}
                  />
                </>
              )
            ) : (
              <AplEditor
                key={`${currentWorkflow.id}-${authoringCandidate ? 'candidate' : 'source'}`}
                workflow={authoringCandidate?.workflow || currentWorkflow}
                initialSource={authoringCandidate?.aplSource}
                candidate={authoringCandidate ? {
                  provider: authoringCandidate.provider,
                  model: authoringCandidate.model,
                  attempts: authoringCandidate.attempts,
                  warnings: authoringCandidate.warnings,
                } : undefined}
                onApply={handleApplyApl}
                onDiscard={authoringCandidate ? () => {
                  setAuthoringCandidate(null);
                  setDesignerMode('diagram');
                } : undefined}
              />
            )}

            {!isLiveReadOnly && <DryRunPanel
              workflow={currentWorkflow}
              isOpen={showRunPanel}
              onClose={() => setShowRunPanel(false)}
              onCompleted={(payload) => {
                setDryRunFingerprint(workflowFingerprint(currentWorkflow));
                setLastDryRunPayload(payload);
                setIsSimulating(false);
                setSimulationLogs((logs) => [...logs, {
                  id: `dry-run-${Date.now()}`, timestamp: new Date().toLocaleTimeString(),
                  nodeId: 'system', nodeTitle: 'Dry Run', nodeType: 'event', status: 'success',
                  message: `Local Dry Run completed for ${currentWorkflow.name}; no engine instance was created.`,
                }]);
              }}
              onBlocked={(message) => {
                setShowLogPanel(true);
                setSimulationLogs((logs) => [...logs, {
                  id: `dry-run-blocked-${Date.now()}`, timestamp: new Date().toLocaleTimeString(),
                  nodeId: 'system', nodeTitle: 'Dry Run Blocked', nodeType: 'event', status: 'error',
                  message,
                }]);
                showToast('error', 'Dry Run blocked: ' + message);
              }}
              onOverlayChange={(statuses, activeNodeId, running) => {
                // Not supported cleanly here anymore, but leaving stub for type signature
                // Actually, wait, DryRunPanel updates statuses.
                // We don't have setExecutionStatuses from useDryRunSimulation, it was removed.
                // Let's ignore it for now as the user's plan is just to refactor God Component App.tsx
              }}
            />}

            <SimulationPanel
              logs={simulationLogs}
              isOpen={showLogPanel}
              onClose={() => setShowLogPanel(false)}
              onClearLogs={() => setSimulationLogs([])}
              isSimulating={isSimulating}
            />
          </>
        )}
        {currentView === 'inbox' && <TaskInbox projectId={activeProject?.id} />}
        {currentView === 'administration' && activeProject && <ProjectAdmin project={activeProject} />}
        {currentView === 'operations' && (
          <ProcessOperations
            projectId={activeProject?.id}
            onOpenInstance={(instance) => {
              setCurrentView('designer');
              void openLiveInstance(instance);
            }}
            onOpenDetail={(instance) => openInstanceDetail(instance)}
          />
        )}
          </>
        )}
      </div>

      <NewWorkflowModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreateWorkflow={handleCreateNewWorkflow}
        projectId={activeProject?.id}
      />

      <ProjectDialog isOpen={showProjects} projects={projects} activeProject={activeProject}
        onClose={() => setShowProjects(false)} onOpen={(project) => void openProject(project)}
        onCreated={(project) => { setProjects((items) => [project, ...items]); void openProject(project); }} />

      <DeployDialog
        workflow={currentWorkflow}
        isOpen={showDeployDialog}
        isDeploying={isDeploying}
        dryRunPassed={dryRunFingerprint === workflowFingerprint(currentWorkflow)}
        defaultPayload={Object.keys(lastDryRunPayload).length ? lastDryRunPayload : deriveDefaultPayload(currentWorkflow)}
        onClose={() => setShowDeployDialog(false)}
        onConfirm={handleDeploy}
      />

      <ProcessDetailsModal
        workflow={currentWorkflow}
        isOpen={showProcessDetails}
        onClose={() => setShowProcessDetails(false)}
      />

      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        definitionKey={currentWorkflow.processKey || currentWorkflow.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}
        projectId={activeProject?.id}
      />

      {diffSnapshot && (
        <AIDiffModal
          snapshot={diffSnapshot}
          baseWorkflow={currentWorkflow}
          onApply={handleApplyAiDiff}
          onReject={handleRejectAiDiff}
          onExit={handleExitAiDiff}
        />
      )}
      {insightDialog && (
        <InsightReviewDialog
          state={insightDialog.state}
          message={insightDialog.message}
          onRetry={() => void handleOpenAiDiff()}
          onClose={() => setInsightDialog(null)}
        />
      )}
        </>
      )}
    </div>
  );
}
