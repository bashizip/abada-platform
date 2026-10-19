import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { SidePanel } from '@/components/SidePanel';
import { Canvas } from '@/features/designer/Canvas';
import { PropertiesInspector } from '@/components/PropertiesInspector';
import { NLInputBar } from '@/components/NLInputBar';
import { SimulationPanel } from '@/components/SimulationPanel';
import { NewWorkflowModal } from '@/components/NewWorkflowModal';
import { ProcessDetailsModal } from '@/components/ProcessDetailsModal';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ProjectDialog } from '@/components/ProjectDialog';
import { SignInGate } from '@/components/SignInGate';
import { switchDirection, type StudioView } from '@/lib/studioViews';
import { AIDiffModal } from '@/features/designer/AIDiffModal';
import { InsightReviewDialog } from '@/features/designer/InsightReviewDialog';
import { TaskInbox } from '@/features/inbox/TaskInbox';
import { ProjectAdmin } from '@/features/admin/ProjectAdmin';
import { AdministrationView } from '@/features/admin/AdministrationView';
import { InsightPanel } from '@/features/insight/InsightPanel';
import { Activity, ExternalLink, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useMotionVariants, viewSwitch } from '@/lib/motion';
import { ProcessOperations } from '@/features/operations/ProcessOperations';
import { InstanceOverviewBar } from '@/features/operations/InstanceOverviewBar';
import { LiveInstanceInspector } from '@/features/operations/LiveInstanceInspector';
import { InstanceDetailView } from '@/features/operations/InstanceDetailView';
import { DryRunPanel } from '@/features/run/DryRunPanel';
import { DeployDialog } from '@/features/run/DeployDialog';
import { hasAgentNodes } from '@/lib/agentModels';
import { issuesToLogs } from '@/lib/apl/issues';
import { AiProvidersAPI } from '@/api/aiProviders';
import { AplAPI } from '@/api/apl';
import { agentModelsOf, missingProviderMessage } from '@/lib/aiProviders';
import { EngineAPI, type ProcessInstanceDTO } from '@/api/engine';
import { InsightAPI } from '@/api/insight';
import { ProjectAPI } from '@/api/projects';
import { keycloak } from '@/auth/keycloakClient';
import { stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import { AplEditor } from '@/features/designer/AplEditor';
import { useToast } from '@/components/ToastContext';
import { playCue } from '@/lib/sound';
import { useProjectWorkspace } from '@/hooks/useProjectWorkspace';
import { useLiveInstanceOverlay } from '@/hooks/useLiveInstanceOverlay';
import { PlaybackControl } from '@/components/PlaybackControl';
import { useDryRunSimulation } from '@/hooks/useDryRunSimulation';
import { useAplAuthoringState } from '@/hooks/useAplAuthoringState';
import { useAplValidation } from '@/hooks/useAplValidation';
import { dropNodeReferences, isOutcomeRouteEdge, removeEdge, setRoute, type Route } from '@/lib/apl/routes';
import { deriveDefaultPayload } from '@/lib/run/liveRun';
import { getDefaultAgentModel, initAgentModel } from '@/lib/agentModels';
import { loadAplContract, reloadAplContract } from '@/lib/aplContract';
import { useAiProvidersVersion } from '@/lib/aiProviderEvents';
import { isEditableTarget, undoShortcut } from '@/lib/history/shortcuts';
import { WorkflowDiffSnapshot } from '@/lib/aiDiff/types';
import { WorkflowFile, WorkflowNode, WorkflowEdge, NodeType } from '@/types';
import { createNode, type NodeKind } from '@/features/designer/nodes/nodeCatalog';
import { dryRunFingerprint as computeDryRunFingerprint } from '@/lib/run/workflowFingerprint';
import { canRetryIncidents, canRollBackProcess } from '@/lib/run/incidents';
import { LEAD_TRIAGE_EXAMPLES, STARTER_PROCESS_KEY } from '@/lib/starter/leadTriage';
import { runSequentialInsightEvidence } from '@/lib/starter/insightEvidence';

type DesignerMode = 'diagram' | 'apl';
type DetailOrigin = { view: 'operations' } | { view: 'designer'; liveInstance?: ProcessInstanceDTO };

/** The designer's side panels: resizable within these bounds, pinned beside the canvas or folded to a rail. */
const EXPLORER_PANEL = { defaultWidth: 256, minWidth: 200, maxWidth: 480 };
const INSPECTOR_PANEL = { defaultWidth: 320, minWidth: 280, maxWidth: 640 };

export default function App() {
  const { showToast } = useToast();
  const [authenticated, setAuthenticated] = useState<boolean>(keycloak.authenticated === true);
  const [currentView, setCurrentView] = useState<StudioView>('designer');
  // The side the current view arrived from, derived when the view changes (M5 view switch).
  const [arrivedView, setArrivedView] = useState<StudioView>(currentView);
  const [viewDirection, setViewDirection] = useState<-1 | 0 | 1>(0);
  if (arrivedView !== currentView) {
    setViewDirection(switchDirection(arrivedView, currentView));
    setArrivedView(currentView);
  }
  const viewVariants = useMotionVariants(useMemo(() => viewSwitch(viewDirection), [viewDirection]));
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
  const [insightEvidenceRunning, setInsightEvidenceRunning] = useState(false);

  const {
    workflows, setWorkflows, activeWorkflowId, setActiveWorkflowId,
    currentWorkflow, projects, setProjects, activeProject,
    showProjects, setShowProjects, treeRefreshKey, setTreeRefreshKey,
    openProject, updateActiveWorkflow, recordHistory, undo, redo, canUndo, canRedo,
    processesRootId, persistedProcessKeys,
    workspaceStatus, workspaceError, retryWorkspace
  } = useProjectWorkspace(authenticated);

  const {
    isSimulating, setIsSimulating, simulationLogs, setSimulationLogs,
    showLogPanel, setShowLogPanel, showRunPanel, setShowRunPanel,
    dryRunFingerprint, setDryRunFingerprint, lastDryRunPayload, setLastDryRunPayload,
    activeSimulationNodeId, setActiveSimulationNodeId, dryRunPath, setDryRunPath,
  } = useDryRunSimulation();

  const {
    selectedLiveInstance, liveWorkflow, activeLiveNodeIds, liveSelectedNodeId, setLiveSelectedNodeId,
    executionStatuses, setExecutionStatuses, activePathEdges, activeTokenEdges, nextPathEdges, instancePath, playback,
    instancesRefreshKey, setInstancesRefreshKey,
    instancePanelOpen, setInstancePanelOpen, detailInstance, setDetailInstance, detailFocusNodeId, detailStartedId,
    livePanelWidth, setLivePanelWidth, livePanelPinned, setLivePanelPinned,
    openLiveInstance, openInstanceDetail, clearLiveInstanceState
  } = useLiveInstanceOverlay(activeProject, workflows, setSidebarTab, setDesignerMode, setShowRunPanel, setCurrentView, setSimulationLogs);

  /**
   * Where the instance view was opened from, so Back returns there: Operations,
   * or the canvas (watching that instance live, or editing after Deploy & Start).
   */
  const [detailOrigin, setDetailOrigin] = useState<DetailOrigin>({ view: 'operations' });
  const openDetailFrom = (origin: DetailOrigin, instance: ProcessInstanceDTO, focusNodeId?: string,
    options?: { justStarted?: boolean }) => {
    setDetailOrigin(origin);
    openInstanceDetail(instance, focusNodeId, options);
  };

  const {
    authoringCandidate, setAuthoringCandidate, isGenerating, handleGenerateWorkflow,
    authoringError, setAuthoringError
  } = useAplAuthoringState(activeProject, currentWorkflow, setSimulationLogs, setDesignerMode);

  const displayedWorkflow = selectedLiveInstance && liveWorkflow ? liveWorkflow : currentWorkflow;
  const isLiveReadOnly = !!selectedLiveInstance;
  const selectedNode = currentWorkflow.nodes.find((n) => n.id === selectedNodeId) || null;
  // Engine validation of the document on the canvas, badged on the nodes it is about.
  const validation = useAplValidation(currentWorkflow, designerMode === 'diagram' && !!activeProject);

  // Undo/redo for the open process, with a whoosh back or forward.
  const undoEdit = useCallback(() => {
    if (!canUndo) return;
    playCue('navigate', { emphasis: 'subtle', direction: 'back' });
    undo();
  }, [canUndo, undo]);
  const redoEdit = useCallback(() => {
    if (!canRedo) return;
    playCue('navigate', { emphasis: 'subtle', direction: 'forward' });
    redo();
  }, [canRedo, redo]);

  // Text fields keep their own native undo, and nothing happens while a modal
  // dialog is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = undoShortcut(event);
      if (!shortcut || isEditableTarget(event.target) || isLiveReadOnly || designerMode !== 'diagram') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      if (shortcut === 'undo') undoEdit(); else redoEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoEdit, redoEdit, isLiveReadOnly, designerMode]);

  // Load the saved AI model and the engine's APL contract on startup, and again
  // whenever the AI providers change (a new key can bring new allowed models).
  const aiProvidersVersion = useAiProvidersVersion();
  useEffect(() => {
    void initAgentModel();
    void (aiProvidersVersion === 0 ? loadAplContract() : reloadAplContract());
  }, [aiProvidersVersion]);

  useEffect(() => {
    if (currentView !== 'designer') setShowLogPanel(false);
  }, [currentView, setShowLogPanel]);

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

  const handleNodeMove = (id: string, x: number, y: number) => {
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    }), `move:${id}`);
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
      const before = workflows.find((item) => item.id === targetId)!;
      recordHistory(targetId, before, appliedWorkflow);
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
    if (!currentWorkflow.layoutPending) playCue('navigate', { emphasis: 'subtle' });
    // The automatic first layout of a newly opened process is not an undo step.
    updateActiveWorkflow((wf) => ({ ...wf, nodes: layoutedNodes, layoutPending: false }),
      currentWorkflow.layoutPending ? null : undefined);
  };

  const handleUpdateNode = (updatedNode: WorkflowNode) => {
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => (n.id === updatedNode.id) ? updatedNode : n),
    }), `node:${updatedNode.id}`);
  };

  const handleDeleteNode = (id: string) => {
    // Routes elsewhere that pointed at the node are cleared, so saving never references it.
    playCue('close');
    updateActiveWorkflow((wf) => dropNodeReferences(wf, id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  /** Deletes an edge; a route edge clears the route it stands for. One undo step. */
  const handleDeleteEdge = (edgeId: string) => {
    playCue('close', { emphasis: 'subtle' });
    updateActiveWorkflow((wf) => removeEdge(wf, edgeId));
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

  /**
   * Adds a node of `kind`: at `at` when dropped on the canvas, otherwise after
   * the selected node and connected from it (never from an end event).
   */
  const handleAddNode = (kind: NodeKind, at?: { x: number; y: number }) => {
    playCue('tap', { emphasis: 'strong' });
    const taken = new Set(currentWorkflow.nodes.map((node) => node.id));
    const base = kind.replace(/-/g, '_');
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
    const selected = currentWorkflow.nodes.find((node) => node.id === selectedNodeId);
    const position = at
      ?? (selected ? { x: selected.x + 260, y: selected.y } : { x: 120 + currentWorkflow.nodes.length * 260, y: 220 });
    const newNode = createNode(kind, id, position);
    const connectFrom = !at && selected && !(selected.type === 'event' && selected.subtype === 'end') ? selected.id : null;
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: [...wf.nodes, newNode],
      edges: connectFrom ? [...wf.edges, { id: `e-${Date.now()}`, source: connectFrom, target: id }] : wf.edges,
    }));
    setSelectedNodeId(id);
  };

  /**
   * A new connection. From a task it carries the route chosen in the connect
   * menu (next replaces the step's successor); from a gateway or an event it
   * adds a flow, never a duplicate of an existing one.
   */
  const handleConnectNodes = (sourceId: string, targetId: string, route: Route = { kind: 'next' }) => {
    if (sourceId === targetId) return;
    if (route.kind === 'next'
      && currentWorkflow.edges.some((e) => e.source === sourceId && e.target === targetId && !isOutcomeRouteEdge(e))) {
      return;
    }
    playCue('toggle');
    updateActiveWorkflow((wf) => setRoute(wf, sourceId, route, targetId));
  };

  const _handleAddDownstreamNode = (sourceId: string, type: NodeType) => {
    const sourceNode = currentWorkflow.nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return;
    const newId = `${type}-${Date.now()}`;
    const newNode: WorkflowNode = {
      id: newId, type, title: type === 'agent' ? 'Secondary AI Agent' : 'Subsequent Task',
      description: 'Downstream node added from toolbar', x: sourceNode.x + 240, y: sourceNode.y,
      agentConfig: type === 'agent' ? { model: getDefaultAgentModel(), systemPrompt: 'Downstream agent handling post-processing.', confidenceThreshold: 0, temperature: 0.1, tools: [] } : undefined,
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
      // The engine validates exactly as it deploys; errors block here with node-level detail.
      const validation = await AplAPI.validate(stringifyAPLYaml(workflowToAPL(currentWorkflow)));
      const issueLogs = issuesToLogs(validation.issues, currentWorkflow.nodes);
      if (issueLogs.length > 0) setSimulationLogs(prev => [...prev, ...issueLogs]);
      if (!validation.valid) {
        const errors = validation.issues.filter((issue) => issue.severity === 'ERROR').length;
        throw new Error(`${errors} APL error${errors === 1 ? '' : 's'} block deployment; see the log panel.`);
      }
      const warningCount = validation.issues.length;
      if (hasAgentNodes(currentWorkflow.nodes)) {
        const providerStatus = await AiProvidersAPI.status(agentModelsOf(currentWorkflow.nodes));
        if (!providerStatus.configured) throw new Error(missingProviderMessage(providerStatus.unconfiguredModels));
      }
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
      if (activeProject && deployWorkflow.documentId) {
        const refreshedDocument = (await ProjectAPI.documents(activeProject.id))
          .find((document) => document.id === deployWorkflow.documentId);
        if (refreshedDocument) {
          deployWorkflow = {
            ...deployWorkflow,
            revision: refreshedDocument.revision,
            updatedAt: refreshedDocument.updatedAt,
          };
          setWorkflows((items) => items.map((item) =>
            item.id === deployWorkflow.id ? deployWorkflow : item));
        }
      }
      const { processInstanceId } = await EngineAPI.startProcess(response.processKey, payload, activeProject?.id);
      const instance = await EngineAPI.getInstance(processInstanceId, activeProject?.id);
      setSimulationLogs(prev => [...prev, { id: `deploy-${Date.now()}-2`, timestamp: new Date().toLocaleTimeString(), nodeId: 'system', nodeTitle: 'Abada Engine', nodeType: 'event', status: 'success', message: `Deployed [${response.processKey}] v${response.version} and started live instance ${processInstanceId}.` }]);
      setShowDeployDialog(false);
      setInstancesRefreshKey((value) => value + 1);
      showToast(warningCount > 0 ? 'warning' : 'success', warningCount > 0
        ? `Deployed and started with ${warningCount} APL warning${warningCount === 1 ? '' : 's'}; see the log panel.`
        : 'Successfully deployed workflow and started process instance.', undefined, { emphasis: 'strong' });
      // The instance view, with the audit trail open, plays the new run from its first step (M5 S5).
      openDetailFrom({ view: 'designer' }, instance, undefined, { justStarted: true });
    } catch (err: any) {
      setSimulationLogs(prev => [...prev, { id: `deploy-${Date.now()}-err`, timestamp: new Date().toLocaleTimeString(), nodeId: 'system', nodeTitle: 'Deploy & Start Error', nodeType: 'event', status: 'error', message: `Deploy & Start failed: ${err.message}` }]);
      showToast('error', err.message || 'Deployment failed');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleGenerateInsightEvidence = async () => {
    if (!activeProject || currentWorkflow.processKey !== STARTER_PROCESS_KEY || insightEvidenceRunning) return;
    if (!window.confirm('Start four real LOW lead executions? This makes four Gemini API requests and does not approve any Insight proposal.')) return;
    setInsightEvidenceRunning(true);
    try {
      await runSequentialInsightEvidence({
        count: 4,
        start: async (index) => {
          const payload = structuredClone(LEAD_TRIAGE_EXAMPLES.LOW) as Record<string, any>;
          payload.lead.id = `LEAD-LOW-INSIGHT-${index + 1}-${Date.now()}`;
          const { processInstanceId } = await EngineAPI.startProcess(
            STARTER_PROCESS_KEY, payload, activeProject.id);
          return processInstanceId;
        },
        get: (processInstanceId) => EngineAPI.getInstance(processInstanceId, activeProject.id),
        wait: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
      });
      showToast('success', 'Four LOW executions completed. Insight is analyzing the persisted evidence.');
      setInstancesRefreshKey((value) => value + 1);
      setShowDeployDialog(false);
      setCurrentView('insight');
    } catch (reason) {
      showToast('error', reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInsightEvidenceRunning(false);
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
    // `name` is the APL metadata.name; the file name is kept apart in `fileName`.
    const draft: WorkflowFile = { ...seeded, id: `draft-${Date.now()}`, name: seeded.name || fileName, fileName, processKey: seeded.processKey || fileName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || `process_${Date.now()}` };
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
      {authenticated && workspaceStatus !== 'ready' && (
        <div className="flex flex-1 items-center justify-center bg-[#1A1614] p-6">
          <div className="w-full max-w-md rounded-2xl border border-[#3A322E] bg-[#25201D] p-6 text-center shadow-warm-lg">
            {workspaceStatus !== 'error' ? (
              <>
                <Activity className="mx-auto h-7 w-7 animate-pulse text-[#2A9D8F]" />
                <h1 className="mt-3 text-sm font-semibold">Preparing your Abada workspace</h1>
                <p className="mt-1 text-xs text-[#A89F91]">{workspaceStatus === 'seeding' ? 'Creating and deploying the Lead Triage starter…' : 'Loading projects and process definitions…'}</p>
              </>
            ) : (
              <>
                <h1 className="text-sm font-semibold text-[#E76F51]">Workspace setup needs attention</h1>
                <p className="mt-2 text-xs text-[#A89F91]">{workspaceError || 'The workspace could not be initialized.'}</p>
                <button type="button" onClick={() => void retryWorkspace()}
                  className="mt-4 rounded-lg bg-[#F4A261] px-4 py-2 text-xs font-semibold text-[#1A1614]">Retry setup</button>
              </>
            )}
          </div>
        </div>
      )}
      {authenticated && workspaceStatus === 'ready' && (
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
      <m.div key={currentView} variants={viewVariants} initial="initial" animate="enter"
        className="flex flex-1 overflow-hidden relative">
        {currentView === 'instance' && detailInstance ? (
          <InstanceDetailView
            key={detailInstance.id}
            instanceId={detailInstance.id}
            projectId={activeProject?.id}
            canRetryIncidents={canRetryIncidents(activeProject?.currentUserRoles)}
            canRollBack={canRollBackProcess(activeProject?.currentUserRoles)}
            initialInstance={detailInstance}
            initialFocusNodeId={detailFocusNodeId}
            playFromStart={detailStartedId === detailInstance.id}
            backLabel={detailOrigin.view === 'designer' ? 'Canvas' : 'Operations'}
            onBack={() => {
              setDetailInstance(null);
              setCurrentView(detailOrigin.view);
              if (detailOrigin.view === 'designer' && detailOrigin.liveInstance) void openLiveInstance(detailOrigin.liveInstance);
            }}
            onOpenCanvas={(instance) => {
              setCurrentView('designer');
              void openLiveInstance(instance);
            }}
            onOpenInstance={(id) => {
              void EngineAPI.getInstance(id, activeProject?.id).then(setDetailInstance).catch(() => undefined);
            }}
          />
        ) : (
          <>
        {currentView === 'designer' && (
          <SidePanel id="designer-explorer" side="left" label="Explorer" bounds={EXPLORER_PANEL}>
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
            onOpenInstanceDetail={(instance) => openDetailFrom({ view: 'designer' }, instance)}
            instancesRefreshKey={instancesRefreshKey}
            treeRefreshKey={treeRefreshKey}
          />
          </SidePanel>
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
                {!['COMPLETED', 'FAILED', 'CANCELLED'].includes((selectedLiveInstance.status || '').toUpperCase()) && (
                  <PlaybackControl pace={playback.pace} onPaceChange={playback.setPace} lag={playback.lag}
                    onJumpToNow={playback.jumpToNow} className="ml-1" />
                )}
                <button type="button" onClick={() => openDetailFrom({ view: 'designer', liveInstance: selectedLiveInstance }, selectedLiveInstance)}
                  title="Open this instance in Operations"
                  className="ml-1 flex items-center gap-1 rounded-md border border-hairline px-2 py-0.5 text-[10.5px] font-semibold text-sand transition-colors hover:border-mineral-teal/60 hover:text-linen">
                  <ExternalLink className="h-3 w-3" aria-hidden="true" /> Operations
                </button>
                <button type="button" onClick={clearLiveInstanceState} aria-label="Leave the live view" title="Leave the live view and edit the process"
                  className="grid h-5 w-5 place-items-center rounded-md text-sand transition-colors hover:bg-charcoal hover:text-linen">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
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
                      layoutPending={displayedWorkflow.layoutPending}
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
                      activePathEdges={activePathEdges}
                      activeTokenEdges={activeTokenEdges}
                      nextPathEdges={nextPathEdges}
                      path={instancePath}
                      animateArrivals={playback.pace !== 'instant'}
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
                        canRetryJobs={canRetryIncidents(activeProject?.currentUserRoles)}
                        onOpenInstance={(id) => {
                          void EngineAPI.getInstance(id, activeProject?.id)
                            .then((child) => openLiveInstance(child)).catch(() => undefined);
                        }}
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
                    layoutPending={displayedWorkflow.layoutPending}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={handleSelectNode}
                    onNodeMove={handleNodeMove}
                    onDeleteNode={handleDeleteNode}
                    onConnectNodes={handleConnectNodes}
                    onDeleteEdge={handleDeleteEdge}
                    issueCounts={validation.issueCounts}
                    onAutoLayout={handleAutoLayout}
                    onAddNode={handleAddNode}
                    onOpenAplEditor={() => setDesignerMode('apl')}
                    onFocusPrompt={() => document.getElementById('workflow-prompt')?.focus()}
                    onToast={(msg) => showToast('success', msg)}
                    processKey={currentWorkflow.processKey}
                    isSimulating={isSimulating}
                    activeSimulationNodeId={activeSimulationNodeId}
                    executionStatuses={executionStatuses}
                    activeLiveNodeIds={activeLiveNodeIds}
                    // While the Dry Run panel is open, its path is drawn like an instance's.
                    path={showRunPanel ? dryRunPath : undefined}
                    animateArrivals={showRunPanel && playback.pace !== 'instant'}
                    readOnly={false}
                    onUndo={undoEdit}
                    onRedo={redoEdit}
                    canUndo={canUndo}
                    canRedo={canRedo}
                  />

                  <SidePanel id="designer-inspector" side="right" label="Properties" bounds={INSPECTOR_PANEL}>
                  <PropertiesInspector
                    selectedNode={selectedNode}
                    onUpdateNode={handleUpdateNode}
                    onUpdateWorkflow={(updater) => updateActiveWorkflow(updater, 'process-properties')}
                    workflow={currentWorkflow}
                    nodeCount={currentWorkflow.nodes.length}
                    projectId={activeProject?.id}
                    issues={selectedNode ? validation.issuesByNode.get(selectedNode.id) : validation.processIssues}
                  />
                  </SidePanel>

                  <NLInputBar
                    onGenerateWorkflow={handleGenerateWorkflow}
                    isGenerating={isGenerating}
                    hasActiveWorkflow={!!activeProject}
                    error={authoringError}
                    onDismissError={() => setAuthoringError(null)}
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
                  summary: authoringCandidate.summary,
                  changes: authoringCandidate.changes,
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
                setDryRunFingerprint(computeDryRunFingerprint(currentWorkflow));
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
              onOverlayChange={(statuses, activeNodeId, running, path) => {
                setExecutionStatuses(statuses);
                setActiveSimulationNodeId(activeNodeId);
                setIsSimulating(running);
                setDryRunPath(path);
              }}
            />}

            <SimulationPanel
              logs={simulationLogs}
              isOpen={showLogPanel}
              onClose={() => setShowLogPanel(false)}
              onClearLogs={() => {
                setSimulationLogs([]);
                setShowLogPanel(false);
              }}
              isSimulating={isSimulating}
            />
          </>
        )}
        {currentView === 'inbox' && <TaskInbox projectId={activeProject?.id} />}
        {currentView === 'administration' && <AdministrationView activeProject={activeProject} />}
        {currentView === 'insight' && <InsightPanel projectId={activeProject?.id} />}
        {currentView === 'operations' && (
          <ProcessOperations
            projectId={activeProject?.id}
            canRetryIncidents={canRetryIncidents(activeProject?.currentUserRoles)}
            canRollBack={canRollBackProcess(activeProject?.currentUserRoles)}
            onOpenInstance={(instance) => {
              setCurrentView('designer');
              void openLiveInstance(instance);
            }}
            onOpenDetail={(instance) => openDetailFrom({ view: 'operations' }, instance)}
            onOpenDesigner={() => setCurrentView('designer')}
            onOpenIncident={(incident) => {
              void EngineAPI.getInstance(incident.processInstanceId, activeProject?.id)
                .then((instance) => openDetailFrom({ view: 'operations' }, instance, incident.activityId)).catch(() => undefined);
            }}
          />
        )}
          </>
        )}
      </m.div>

      <AnimatePresence>
      {isNewModalOpen && <NewWorkflowModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreateWorkflow={handleCreateNewWorkflow}
        projectId={activeProject?.id}
      />}
      </AnimatePresence>

      <AnimatePresence>
      {showProjects && <ProjectDialog isOpen={showProjects} projects={projects} activeProject={activeProject}
        onClose={() => setShowProjects(false)} onOpen={(project) => void openProject(project)}
        onCreated={(project) => { setProjects((items) => [project, ...items]); void openProject(project); }} />}
      </AnimatePresence>

      <AnimatePresence>
      {showDeployDialog && <DeployDialog
        workflow={currentWorkflow}
        isOpen={showDeployDialog}
        isDeploying={isDeploying}
        dryRunPassed={dryRunFingerprint === computeDryRunFingerprint(currentWorkflow)}
        defaultPayload={Object.keys(lastDryRunPayload).length
          ? lastDryRunPayload
          : currentWorkflow.processKey === STARTER_PROCESS_KEY
            ? LEAD_TRIAGE_EXAMPLES.HIGH
            : deriveDefaultPayload(currentWorkflow)}
        onClose={() => setShowDeployDialog(false)}
        onConfirm={handleDeploy}
        examples={currentWorkflow.processKey === STARTER_PROCESS_KEY ? LEAD_TRIAGE_EXAMPLES : undefined}
        onGenerateInsightEvidence={currentWorkflow.processKey === STARTER_PROCESS_KEY ? handleGenerateInsightEvidence : undefined}
        insightEvidenceRunning={insightEvidenceRunning}
      />}
      </AnimatePresence>

      <AnimatePresence>
      {showProcessDetails && <ProcessDetailsModal
        workflow={currentWorkflow}
        isOpen={showProcessDetails}
        onClose={() => setShowProcessDetails(false)}
      />}
      </AnimatePresence>

      <AnimatePresence>
      {showSettings && <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        definitionKey={currentWorkflow.processKey || currentWorkflow.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}
        projectId={activeProject?.id}
      />}
      </AnimatePresence>

      {diffSnapshot && (
        <AIDiffModal
          snapshot={diffSnapshot}
          baseWorkflow={currentWorkflow}
          onApply={handleApplyAiDiff}
          onReject={handleRejectAiDiff}
          onExit={handleExitAiDiff}
        />
      )}
      <AnimatePresence>
      {insightDialog && (
        <InsightReviewDialog
          state={insightDialog.state}
          message={insightDialog.message}
          onRetry={() => void handleOpenAiDiff()}
          onClose={() => setInsightDialog(null)}
        />
      )}
      </AnimatePresence>
        </>
      )}
    </div>
  );
}
