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
import { Activity } from 'lucide-react';
import { ProcessOperations } from '@/features/operations/ProcessOperations';
import { InstanceOverviewBar } from '@/features/operations/InstanceOverviewBar';
import { LiveInstanceInspector } from '@/features/operations/LiveInstanceInspector';
import { InstanceDetailView } from '@/features/operations/InstanceDetailView';
import { DryRunPanel } from '@/features/run/DryRunPanel';
import { DeployDialog } from '@/features/run/DeployDialog';
import { EngineAPI, ProcessInstanceDTO } from '@/api/engine';
import { InsightAPI } from '@/api/insight';
import { AplGenerationCandidate, AuthoringAPI } from '@/api/authoring';
import { Project, ProjectAPI } from '@/api/projects';
import { keycloak } from '@/auth/keycloakClient';
import { aplToWorkflow, parseAPLYaml, stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import { AplEditor } from '@/features/designer/AplEditor';
import {
  deriveDefaultPayload,
  deriveLiveExecutionOverlay,
  NodeRunStatus,
} from '@/lib/run/liveRun';
import { readInspectorPanelPinned, readInspectorPanelWidth, useInspectorPanelPrefs } from '@/lib/run/panelPrefs';
import { autoLayoutWorkflow } from '@/lib/layout/autoLayout';
import { WorkflowDiffSnapshot } from '@/lib/aiDiff/types';
import { WorkflowFile, WorkflowNode, WorkflowEdge, NodeType, EventSubtype, GatewaySubtype, SimulationLog, AgentConfig, LANGUAGE_VERSION_ABADA_IO_V1 } from '@/types';

type StudioView = 'designer' | 'inbox' | 'operations' | 'instance';
type DesignerMode = 'diagram' | 'apl';
interface AuthoringCandidate extends AplGenerationCandidate {
  workflow: WorkflowFile;
  replaceWorkflowId?: string;
}

const createEmptyWorkflow = (
  id: string,
  name = 'Untitled Process',
  processKey = 'untitled_process',
  category: WorkflowFile['category'] = 'custom',
): WorkflowFile => ({
  id,
  name,
  processKey: /^[a-z]/.test(processKey) ? processKey : `process_${processKey}`,
  category,
  fileType: 'apl',
  languageVersion: LANGUAGE_VERSION_ABADA_IO_V1,
  version: '1.0.0',
  updatedAt: 'Just now',
  nodes: [],
  edges: [],
});

const bumpPatchVersion = (version: string): string => {
  const parts = version.split('.');
  if (parts.length !== 3) return version;
  const [, , patch] = parts.map(Number);
  return `${parts[0]}.${parts[1]}.${(patch || 0) + 1}`;
};

export default function App() {
  const bootstrapWorkflow = useRef(createEmptyWorkflow('bootstrap-draft'));
  const [workflows, setWorkflows] = useState<WorkflowFile[]>([]);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>('');
  const [authenticated, setAuthenticated] = useState<boolean>(keycloak.authenticated === true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [designerMode, setDesignerMode] = useState<DesignerMode>('diagram');
  const [authoringCandidate, setAuthoringCandidate] = useState<AuthoringCandidate | null>(null);
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<StudioView>('designer');
  
  // Simulation & Audit logs state
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationLogs, setSimulationLogs] = useState<SimulationLog[]>([]);
  const [showLogPanel, setShowLogPanel] = useState<boolean>(true);

  // Dry Run and live-instance presentation state
  const [showRunPanel, setShowRunPanel] = useState<boolean>(false);
  const [showDeployDialog, setShowDeployDialog] = useState(false);
  const [dryRunFingerprint, setDryRunFingerprint] = useState<string | null>(null);
  const [lastDryRunPayload, setLastDryRunPayload] = useState<Record<string, unknown>>({});
  const [executionStatuses, setExecutionStatuses] = useState<Record<string, NodeRunStatus>>({});
  const [activeSimulationNodeId, setActiveSimulationNodeId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'files' | 'palette' | 'instances'>('files');
  const [selectedLiveInstance, setSelectedLiveInstance] = useState<ProcessInstanceDTO | null>(null);
  const [liveWorkflow, setLiveWorkflow] = useState<WorkflowFile | null>(null);
  const [activeLiveNodeIds, setActiveLiveNodeIds] = useState<string[]>([]);
  const [liveSelectedNodeId, setLiveSelectedNodeId] = useState<string | null>(null);
  const [instancesRefreshKey, setInstancesRefreshKey] = useState(0);
  const [instancePanelOpen, setInstancePanelOpen] = useState(true);
  // Shared inspector layout prefs (width + pin) persist across reloads and are
  // kept in sync between the live canvas view and the full-screen detail view.
  const {
    panelWidth: livePanelWidth,
    setPanelWidth: setLivePanelWidth,
    pinned: livePanelPinned,
    setPinned: setLivePanelPinned,
  } = useInspectorPanelPrefs();
  const [detailInstance, setDetailInstance] = useState<ProcessInstanceDTO | null>(null);

  // AI Diff review state (Insight Engine proposal preview)
  const [diffSnapshot, setDiffSnapshot] = useState<WorkflowDiffSnapshot | null>(null);
  const [insightDialog, setInsightDialog] = useState<null | { state: 'loading' | 'empty' | 'error'; message?: string }>(null);
  const [showProcessDetails, setShowProcessDetails] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Workflow Generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | undefined>();
  const [showProjects, setShowProjects] = useState(false);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const persistedFingerprint = useRef(new Map<string, string>());
  const failedAutosaveFingerprint = useRef(new Map<string, string>());
  const persistedProcessKeys = useRef(new Map<string, string>());
  const creatingWorkflowIds = useRef(new Set<string>());
  const processesRootId = useRef<string | undefined>(undefined);
  const materializedDraftId = useRef<string | undefined>(undefined);

  // Get active workflow object
  const currentWorkflow = workflows.find((w) => w.id === activeWorkflowId)
    || workflows[0] || bootstrapWorkflow.current;
  const displayedWorkflow = selectedLiveInstance && liveWorkflow ? liveWorkflow : currentWorkflow;
  const isLiveReadOnly = !!selectedLiveInstance;
  const selectedNode = currentWorkflow.nodes.find((n) => n.id === selectedNodeId) || null;

  const workflowFingerprint = (workflow: WorkflowFile) => JSON.stringify({
    processKey: workflow.processKey, name: workflow.name, description: workflow.description,
    category: workflow.category, nodes: workflow.nodes, edges: workflow.edges,
  });

  const openProject = async (project: Project) => {
    setAuthoringCandidate(null);
    setSelectedLiveInstance(null);
    setLiveWorkflow(null);
    setActiveLiveNodeIds([]);
    setLiveSelectedNodeId(null);
    setExecutionStatuses({});
    setSidebarTab('files');
    setActiveProject(project);
    localStorage.setItem('abada.studio.projectId', project.id);
    const [documents, tree] = await Promise.all([
      ProjectAPI.documents(project.id),
      ProjectAPI.tree(project.id),
    ]);
    processesRootId.current = tree
      .find((node) => node.kind === 'FOLDER' && node.name === 'processes')?.id;
    if (documents.length) {
      const loaded = documents.map(ProjectAPI.workflow);
      loaded.forEach((workflow) => {
        persistedFingerprint.current.set(workflow.id, workflowFingerprint(workflow));
        if (workflow.documentId && workflow.processKey) {
          persistedProcessKeys.current.set(workflow.documentId, workflow.processKey);
        }
      });
      setWorkflows(loaded);
      setActiveWorkflowId(loaded[0].id);
      setSelectedNodeId(loaded[0].nodes[0]?.id || null);
    } else {
      // No silent draft creation: the tree starts empty and processes are
      // created explicitly through the New Process dialog.
      setWorkflows([]);
      setActiveWorkflowId('');
      setSelectedNodeId(null);
    }
    setDesignerMode('diagram');
    setTreeRefreshKey((value) => value + 1);
  };

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

  useEffect(() => {
    if (!authenticated) return;
    ProjectAPI.list().then((available) => {
      setProjects(available);
      const remembered = localStorage.getItem('abada.studio.projectId');
      const selected = available.find((project) => project.id === remembered) || available[0];
      if (selected) void openProject(selected);
      else setShowProjects(true);
    }).catch(() => setShowProjects(true));
    // Project discovery happens once per authenticated Studio session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  useEffect(() => {
    if (!activeProject) return;
    // The pristine workspace fallback is never persisted on its own; once the
    // user draws on it the first mutation materializes a real draft entry.
    if (currentWorkflow.id === bootstrapWorkflow.current.id) return;
    const persistedProcessKey = currentWorkflow.documentId
      ? persistedProcessKeys.current.get(currentWorkflow.documentId)
      : undefined;
    const workflowToSave = persistedProcessKey && currentWorkflow.processKey !== persistedProcessKey
      ? { ...currentWorkflow, processKey: persistedProcessKey }
      : currentWorkflow;
    const fingerprint = workflowFingerprint(workflowToSave);
    if (persistedFingerprint.current.get(currentWorkflow.id) === fingerprint) return;
    if (failedAutosaveFingerprint.current.get(currentWorkflow.id) === fingerprint) return;
    const timer = window.setTimeout(() => {
      if (!currentWorkflow.documentId && creatingWorkflowIds.current.has(currentWorkflow.id)) return;
      if (!currentWorkflow.documentId) creatingWorkflowIds.current.add(currentWorkflow.id);
      const save = currentWorkflow.documentId
        ? ProjectAPI.saveDocument(activeProject.id, workflowToSave)
        : ProjectAPI.createDocument(activeProject.id, workflowToSave, workflowToSave.description || '',
            { folderId: workflowToSave.folderId ?? processesRootId.current ?? null,
              fileName: workflowToSave.fileName ?? null });
      save.then((saved) => {
        const persistedId = saved.id;
        persistedFingerprint.current.set(persistedId, fingerprint);
        failedAutosaveFingerprint.current.delete(currentWorkflow.id);
        persistedProcessKeys.current.set(persistedId, saved.processKey);
        setWorkflows((items) => items.map((item) => item.id === currentWorkflow.id
          ? { ...item, id: persistedId, documentId: persistedId, revision: saved.revision,
              processKey: saved.processKey, updatedAt: saved.updatedAt } : item));
        if (!currentWorkflow.documentId) {
          setActiveWorkflowId((id) => id === currentWorkflow.id ? persistedId : id);
        }
        setTreeRefreshKey((value) => value + 1);
      }).catch((reason) => {
        failedAutosaveFingerprint.current.set(currentWorkflow.id, fingerprint);
        setSimulationLogs((logs) => [...logs, {
            id: `autosave-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), nodeId: 'system',
            nodeTitle: 'Project Autosave', nodeType: 'event', status: 'error',
            message: reason instanceof Error ? reason.message : String(reason),
          }]);
      }).finally(() => creatingWorkflowIds.current.delete(currentWorkflow.id));
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, currentWorkflow]);

  // Auto-layout is the default: the first time the canvas loads (initial
  // mount and first activation of each workflow), positions are derived from
  // the graph instead of any stored absolute coordinates. Manual drags and
  // the Auto Layout button keep working afterwards.
  const laidOutWorkflowIds = useRef(new Set<string>());
  useLayoutEffect(() => {
    // Pristine empty workspace: layout applies once a draft actually
    // materializes (the first mutation), never on mount.
    if (!activeWorkflowId && workflows.length === 0) return;
    if (laidOutWorkflowIds.current.has(activeWorkflowId)) return;
    laidOutWorkflowIds.current.add(activeWorkflowId);
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: autoLayoutWorkflow(wf.nodes, wf.edges),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkflowId]);

  // Helper to update active workflow nodes/edges. When nothing is active yet
  // (empty project — the pristine workspace fallback is displayed), the first
  // mutation materializes a real draft entry under the processes/ system root
  // and activates it, so drawing and APL apply work even with zero documents.
  const updateActiveWorkflow = (updater: (wf: WorkflowFile) => WorkflowFile) => {
    let targetId: string | undefined = activeWorkflowId;
    if (!targetId || !workflows.some((wf) => wf.id === targetId)) {
      // A materialized draft can be dropped or re-keyed (project reload,
      // autosave id swap) — only reuse it while it still exists in state.
      const refId = materializedDraftId.current;
      targetId = refId && workflows.some((wf) => wf.id === refId) ? refId : undefined;
    }
    if (!targetId) {
      const draftId = `draft-${Date.now()}`;
      materializedDraftId.current = draftId;
      setActiveWorkflowId(draftId);
      const draft = {
        ...updater({ ...bootstrapWorkflow.current, folderId: processesRootId.current }),
        id: draftId,
      };
      setWorkflows((prev) => [draft, ...prev.filter((item) => !item.id.startsWith('draft-'))]);
      return;
    }
    setWorkflows((prev) => prev.map((wf) => (wf.id === targetId ? updater(wf) : wf)));
  };

  // Node Actions
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
      // Applying onto the pristine workspace fallback (empty project): mint a
      // fresh draft under the processes/ system root and activate it.
      const draftId = `draft-${Date.now()}`;
      materializedDraftId.current = draftId;
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

  // Auto-layout the active workflow using the graph-ranked dagre layout.
  const handleAutoLayout = (layoutedNodes: WorkflowNode[]) => {
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: layoutedNodes,
    }));
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

  const handleDuplicateNode = (id: string) => {
    const target = currentWorkflow.nodes.find((n) => n.id === id);
    if (!target) return;
    const newNode: WorkflowNode = {
      ...target,
      id: `${target.type}-${Date.now()}`,
      title: `${target.title} (Copy)`,
      x: target.x + 40,
      y: target.y + 40,
    };
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: [...wf.nodes, newNode],
    }));
    setSelectedNodeId(newNode.id);
  };

  const handleAddNode = (type: NodeType, subtype?: EventSubtype | GatewaySubtype) => {
    const id = `${type}-${Date.now()}`;
    const isFirstEvent = type === 'event'
      && !currentWorkflow.nodes.some((node) => node.type === 'event' && node.subtype === 'start');
    const defaultTitles: Record<NodeType, string> = {
      agent: 'AI Validation Agent',
      human: 'Executive Review Task',
      dmn: 'Risk Matrix Policy',
      gateway: subtype === 'parallel' ? 'Parallel Gateway' : 'Branching Gateway',
      event: isFirstEvent ? 'Start Process' : 'End Process',
      'engine-task': 'Engine Service Task',
    };

    const newNode: WorkflowNode = {
      id,
      type,
      subtype: type === 'event'
        ? (subtype && ((subtype as EventSubtype) === 'start' || (subtype as EventSubtype) === 'end')
          ? (subtype as EventSubtype)
          : isFirstEvent ? 'start' : 'end')
        : type === 'gateway' ? subtype : undefined,
      title: defaultTitles[type],
      description: `Newly instantiated ${type} node`,
      x: 120 + currentWorkflow.nodes.length * 260,
      y: 220,
      agentConfig: type === 'agent' ? {
        model: 'gemini-3.6-flash',
        systemPrompt: 'Evaluate incoming data and perform risk verification.',
        confidenceThreshold: 85,
        temperature: 0.2,
        tools: ['Database Query'],
      } : undefined,
      dmnConfig: type === 'dmn' ? {
        decisionKey: `DMN_POLICY_${Date.now().toString().slice(-4)}`,
        hitPolicy: 'FIRST',
        inputs: [{ name: 'PayloadValue', type: 'NUMBER', expr: '${payload.value}' }],
        outputs: [{ name: 'AllowPass', type: 'BOOLEAN' }],
        rules: [
          { id: 'r1', when: 'PayloadValue > 100', then: { AllowPass: true } },
          { id: 'r2', otherwise: true, then: { AllowPass: false } },
        ],
      } : undefined,
      humanConfig: type === 'human' ? {
        assigneeRole: 'Operations Analyst',
        slaHours: 24,
        formFields: ['Review Notes', 'Approval Signature'],
      } : undefined,
      engineTaskConfig: type === 'engine-task' ? {
        service: 'abada:service',
      } : undefined,
    };

    updateActiveWorkflow((wf) => {
      const sourceExists = selectedNodeId && wf.nodes.some((node) => node.id === selectedNodeId);
      return {
        ...wf,
        nodes: [...wf.nodes, newNode],
        edges: sourceExists
          ? [...wf.edges, { id: `e-${Date.now()}`, source: selectedNodeId, target: id, label: 'Next' }]
          : wf.edges,
      };
    });
    setSelectedNodeId(id);
  };

  const handleConnectNodes = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const exists = currentWorkflow.edges.some((e) => e.source === sourceId && e.target === targetId);
    if (exists) return;

    const newEdge: WorkflowEdge = {
      id: `e-${Date.now()}`,
      source: sourceId,
      target: targetId,
      label: 'Flow Connection',
    };

    updateActiveWorkflow((wf) => ({
      ...wf,
      edges: [...wf.edges, newEdge],
    }));
  };

  const handleAddDownstreamNode = (sourceId: string, type: NodeType) => {
    const sourceNode = currentWorkflow.nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return;

    const newId = `${type}-${Date.now()}`;
    const newNode: WorkflowNode = {
      id: newId,
      type,
      title: type === 'agent' ? 'Secondary AI Agent' : 'Subsequent Task',
      description: 'Downstream node added from toolbar',
      x: sourceNode.x + 240,
      y: sourceNode.y,
      agentConfig: type === 'agent' ? {
        model: 'gemini-3.6-flash',
        systemPrompt: 'Downstream agent handling post-processing.',
        confidenceThreshold: 90,
        temperature: 0.1,
        tools: ['API Webhook'],
      } : undefined,
    };

    const newEdge: WorkflowEdge = {
      id: `e-${Date.now()}`,
      source: sourceId,
      target: newId,
      label: 'Next Step',
    };

    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: [...wf.nodes, newNode],
      edges: [...wf.edges, newEdge],
    }));
    setSelectedNodeId(newId);
  };

  // Open the local, non-persistent Dry Run panel.
  const handleOpenRunPanel = () => {
    setShowLogPanel(false);
    setShowRunPanel(true);
    setSelectedLiveInstance(null);
    setLiveWorkflow(null);
  };

  const handleOpenAiDiff = async () => {
    setInsightDialog({ state: 'loading' });
    const definitionKey = currentWorkflow.processKey
      || currentWorkflow.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    try {
      const page = await InsightAPI.listProposals(definitionKey, activeProject?.id);
      const summary = page.items.find((item) => item.status === 'DRAFT' || item.status === 'IN_REVIEW');
      if (!summary) {
        setInsightDialog({ state: 'empty' });
        return;
      }
      setDiffSnapshot(InsightAPI.toDiffSnapshot(await InsightAPI.getProposal(summary.id, activeProject?.id)));
      setInsightDialog(null);
    } catch (error) {
      setInsightDialog({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleExitAiDiff = () => {
    setDiffSnapshot(null);
    setInsightDialog(null);
  };

  // Governance gate approval: adopt the proposed graph as the new definition
  // (Studio-side preview; engine version commit lands with Phase 3).
  const handleApplyAiDiff = async (comment: string) => {
    if (!diffSnapshot?.backend) return;
    const reviewed = await InsightAPI.reviewProposal(diffSnapshot.backend.id, 'APPROVE', comment,
      diffSnapshot.backend.updatedAt, activeProject?.id);
    if (reviewed.status === 'ADOPTED') {
      updateActiveWorkflow((wf) => ({ ...wf, nodes: diffSnapshot.proposedNodes,
        edges: diffSnapshot.proposedEdges, version: String(reviewed.adoptedVersion || wf.version), fileType: 'apl' }));
    }
    setSimulationLogs((prev) => [
      ...prev,
      {
        id: `diff-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        nodeId: 'system',
        nodeTitle: 'Insight Engine',
        nodeType: 'event',
        status: 'success',
        message: `Optimization [${diffSnapshot.proposal.id}] reviewed — status ${reviewed.status}.`,
      },
    ]);
    setDiffSnapshot(null);
  };

  const handleRejectAiDiff = async (comment: string) => {
    if (!diffSnapshot?.backend) return;
    const reviewed = await InsightAPI.reviewProposal(diffSnapshot.backend.id, 'REJECT', comment,
      diffSnapshot.backend.updatedAt, activeProject?.id);
    setSimulationLogs((prev) => [
      ...prev,
      {
        id: `diff-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        nodeId: 'system',
        nodeTitle: 'Insight Engine',
        nodeType: 'event',
        status: 'warning',
        message: `Optimization [${diffSnapshot.proposal.id}] ${reviewed.status.toLowerCase()} by governance. Current definition unchanged.`,
      },
    ]);
    setDiffSnapshot(null);
  };

  // Open the full-screen deep-dive detail view for an instance.
  const openInstanceDetail = useCallback((instance: ProcessInstanceDTO) => {
    // Leave live-canvas presentation state behind so the designer's 1.5s
    // live poll stops running behind the detail view.
    setSelectedLiveInstance(null);
    setLiveWorkflow(null);
    setActiveLiveNodeIds([]);
    setLiveSelectedNodeId(null);
    setExecutionStatuses({});
    setInstancePanelOpen(false);
    setDetailInstance(instance);
    setCurrentView('instance');
  }, []);

  const openLiveInstance = useCallback(async (instance: ProcessInstanceDTO) => {
    if (!activeProject) return;
    // Pick up any layout changes made in the full-screen detail view since boot.
    setLivePanelWidth(readInspectorPanelWidth());
    setLivePanelPinned(readInspectorPanelPinned());
    setSelectedLiveInstance(instance);
    setSidebarTab('instances');
    setDesignerMode('diagram');
    setShowRunPanel(false);
    setInstancePanelOpen(true);
    try {
      const definition = await EngineAPI.getDefinitionForInstance(instance, activeProject.id);
      let instanceWorkflow = workflows.find((workflow) => workflow.processKey === instance.processDefinitionId) || null;
      if (definition?.schemaType === 'APL_NATIVE' && definition.bpmnXml) {
        const parsed = aplToWorkflow(parseAPLYaml(definition.bpmnXml));
        instanceWorkflow = { ...parsed, id: `instance-${instance.id}`, version: String(definition.version) };
      }
      if (!instanceWorkflow) throw new Error('The immutable definition for this instance is unavailable');
      setLiveWorkflow(instanceWorkflow);
      const [fresh, activities, history] = await Promise.all([
        EngineAPI.getInstance(instance.id, activeProject.id),
        EngineAPI.getActivityInstances(instance.id, activeProject.id),
        EngineAPI.getInstanceHistory(instance.id, activeProject.id),
      ]);
      setSelectedLiveInstance(fresh);
      setLiveSelectedNodeId(fresh.currentActivityId ?? instanceWorkflow.nodes[0]?.id ?? null);
      const overlay = deriveLiveExecutionOverlay(instanceWorkflow, fresh, activities, history);
      setExecutionStatuses(overlay.statuses);
      setActiveLiveNodeIds(overlay.activeNodeIds);
    } catch (reason) {
      setSimulationLogs((logs) => [...logs, {
        id: `instance-view-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), nodeId: 'system',
        nodeTitle: 'Live Instance', nodeType: 'event', status: 'error',
        message: reason instanceof Error ? reason.message : String(reason),
      }]);
    }
  }, [activeProject, workflows]);

  const selectedLiveInstanceId = selectedLiveInstance?.id;
  const selectedLiveInstanceStatus = selectedLiveInstance?.status;

  useEffect(() => {
    if (!activeProject || !selectedLiveInstanceId || !liveWorkflow) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [fresh, activities, history] = await Promise.all([
          EngineAPI.getInstance(selectedLiveInstanceId, activeProject.id),
          EngineAPI.getActivityInstances(selectedLiveInstanceId, activeProject.id),
          EngineAPI.getInstanceHistory(selectedLiveInstanceId, activeProject.id),
        ]);
        if (cancelled) return;
        setSelectedLiveInstance(fresh);
        const overlay = deriveLiveExecutionOverlay(liveWorkflow, fresh, activities, history);
        setExecutionStatuses(overlay.statuses);
        setActiveLiveNodeIds(overlay.activeNodeIds);
      } catch {
        // Keep the last authoritative snapshot visible; the next poll retries.
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      const terminal = selectedLiveInstanceStatus?.toUpperCase() || '';
      if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(terminal)) void refresh();
    }, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeProject, liveWorkflow, selectedLiveInstanceId, selectedLiveInstanceStatus]);

  // Deploy the immutable definition, then create and open a live instance.
  const handleDeploy = async (payload: Record<string, unknown>) => {
    if (isDeploying) return;
    setIsDeploying(true);
    setShowLogPanel(true);
    const timestamp = () => new Date().toLocaleTimeString();
    
    setSimulationLogs(prev => [
      ...prev,
      {
        id: `deploy-${Date.now()}-1`,
        timestamp: timestamp(),
        nodeId: 'system',
        nodeTitle: 'Deployment Compiler',
        nodeType: 'event',
        status: 'info',
        message: 'Validating and deploying native abada.io/v1 APL...',
      }
    ]);

    try {
      let deployWorkflow = currentWorkflow;
      if (activeProject) {
        const wasDraft = !currentWorkflow.documentId;
        const saved = currentWorkflow.documentId
          ? await ProjectAPI.saveDocument(activeProject.id, currentWorkflow)
          : await ProjectAPI.createDocument(activeProject.id, currentWorkflow,
              currentWorkflow.description || '',
              { folderId: currentWorkflow.folderId ?? null,
                fileName: currentWorkflow.fileName ?? null });
        deployWorkflow = { ...currentWorkflow, id: saved.id, documentId: saved.id,
          revision: saved.revision, updatedAt: saved.updatedAt };
        persistedFingerprint.current.set(deployWorkflow.id, workflowFingerprint(deployWorkflow));
        setWorkflows((items) => items.map((item) => item.id === currentWorkflow.id
          ? deployWorkflow : item));
        if (wasDraft) setActiveWorkflowId(saved.id);
        setTreeRefreshKey((value) => value + 1);
      }
      const response = activeProject
        ? await ProjectAPI.deployDocument(activeProject.id, deployWorkflow)
        : await EngineAPI.deployWorkflow(currentWorkflow);
      const { processInstanceId } = await EngineAPI.startProcess(
        response.processKey, payload, activeProject?.id
      );
      const instance = await EngineAPI.getInstance(processInstanceId, activeProject?.id);
      setSimulationLogs(prev => [
        ...prev,
        {
          id: `deploy-${Date.now()}-2`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Abada Engine',
          nodeType: 'event',
          status: 'success',
          message: `Deployed [${response.processKey}] v${response.version} and started live instance ${processInstanceId}.`,
        }
      ]);
      setShowDeployDialog(false);
      setInstancesRefreshKey((value) => value + 1);
      await openLiveInstance(instance);
    } catch (err: any) {
      setSimulationLogs(prev => [
        ...prev,
        {
          id: `deploy-${Date.now()}-err`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Deploy & Start Error',
          nodeType: 'event',
          status: 'error',
          message: `Deploy & Start failed: ${err.message}`,
        }
      ]);
      throw err;
    } finally {
      setIsDeploying(false);
    }
  };

  // Generate Workflow from NL Prompt
  const handleGenerateWorkflow = async (promptText: string, mode: 'new' | 'refine' = 'new') => {
    if (!activeProject) {
      setSimulationLogs((logs) => [...logs, { id: `gen-${Date.now()}-project`,
        timestamp: new Date().toLocaleTimeString(), nodeId: 'system', nodeTitle: 'APL Authoring',
        nodeType: 'event', status: 'error', message: 'Open a project before generating APL.' }]);
      return;
    }
    setIsGenerating(true);
    const timestamp = () => new Date().toLocaleTimeString();

    setSimulationLogs(prev => [
      ...prev,
      {
        id: `gen-${Date.now()}-1`,
        timestamp: timestamp(),
        nodeId: 'system',
        nodeTitle: 'APL Authoring',
        nodeType: 'agent',
        status: 'info',
        message: `${mode === 'new' ? 'Creating' : 'Refining'} a native APL candidate for human review.`,
      }
    ]);

    try {
      const candidate = await AuthoringAPI.generate(activeProject.id, promptText, mode,
        mode === 'refine' ? stringifyAPLYaml(workflowToAPL(currentWorkflow)) : undefined);
      const parsed = aplToWorkflow(parseAPLYaml(candidate.aplSource));
      const replaceCurrent = mode === 'refine' || (!currentWorkflow.documentId && currentWorkflow.nodes.length === 0);
      const candidateWorkflow: WorkflowFile = replaceCurrent ? {
        ...parsed, id: currentWorkflow.id,
        documentId: currentWorkflow.documentId, revision: currentWorkflow.revision,
        version: currentWorkflow.version, updatedAt: currentWorkflow.updatedAt,
      } : { ...parsed, id: `draft-generated-${Date.now()}` };
      setAuthoringCandidate({ ...candidate, workflow: candidateWorkflow,
        replaceWorkflowId: replaceCurrent ? currentWorkflow.id : undefined });
      setDesignerMode('apl');

      setSimulationLogs(prev => [
        ...prev,
        {
          id: `gen-${Date.now()}-3`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Studio Compiler',
          nodeType: 'event',
          status: 'success',
          message: `${candidate.provider === 'LLM' ? 'LLM' : 'Local fallback'} produced validated APL in ${candidate.attempts} attempt(s). Review before applying.`,
        }
      ]);

    } catch (err: any) {
      setSimulationLogs(prev => [
        ...prev,
        {
          id: `gen-${Date.now()}-error`,
          timestamp: timestamp(),
          nodeId: 'system', nodeTitle: 'APL Native Generator', nodeType: 'agent', status: 'error',
          message: `APL generation failed: ${err.message}`,
        }
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Test AI Agent Execution
  const handleRunAgentTest = async (agentConfig: AgentConfig, testInput: string) => {
    // Simulated Agent Execution (since backend /api/test-agent doesn't exist yet)
    await new Promise(r => setTimeout(r, 1500));
    
    return {
      success: true,
      confidence: Math.random() * 0.4 + 0.6, // random confidence between 60% and 100%
      result: `Processed input based on prompt: "${agentConfig.systemPrompt}". Determined next step based on reasoning parameters.`,
      flaggedForHuman: false,
    };
  };

  // Export JSON Schema
  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentWorkflow, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${currentWorkflow.name}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Create a new process draft from the dedicated New Process dialog. The
  // dialog prepares the workflow (empty, BPMN-imported or pasted APL); the
  // draft is placed in processes/ and autosave persists it there.
  const handleCreateNewWorkflow = (workflow: WorkflowFile, folderId?: string) => {
    const fileName = (workflow.fileName || workflow.name).endsWith('.apl.yaml')
      ? (workflow.fileName || workflow.name)
      : `${workflow.fileName || workflow.name}.apl.yaml`;
    // The engine requires at least one flow node (flow.nodes must declare at
    // least one node), so an empty process is seeded with the start node —
    // the empty canvas is equivalent to a start node.
    const seeded: WorkflowFile = workflow.nodes.length > 0 ? workflow : {
      ...workflow,
      nodes: [{
        id: 'start', type: 'event', subtype: 'start', title: 'Start Process',
        description: 'Webhook trigger that begins the APL process', x: 120, y: 220,
      }],
    };
    const draft: WorkflowFile = {
      ...seeded,
      id: `draft-${Date.now()}`,
      name: fileName,
      fileName,
      processKey: seeded.processKey
        || fileName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
        || `process_${Date.now()}`,
    };
    if (folderId) draft.folderId = folderId;
    setWorkflows((prev) => [draft, ...prev.filter((item) => !item.id.startsWith('draft-'))]);
    setAuthoringCandidate(null);
    setActiveWorkflowId(draft.id);
    setSelectedNodeId(draft.nodes[0]?.id || null);
    setDesignerMode('diagram');
  };

  // Adopt a process document fetched from the backend that is not part of the
  // locally loaded workflow set (e.g. opened from the project file tree).
  const handleActivateDocument = (workflow: WorkflowFile) => {
    if (!workflow.documentId) {
      setActiveWorkflowId(workflow.id);
      return;
    }
    setWorkflows((prev) => {
      const existing = prev.some((item) => item.documentId === workflow.documentId);
      return existing ? prev : [workflow, ...prev];
    });
    setAuthoringCandidate(null);
    setSelectedLiveInstance(null);
    setLiveWorkflow(null);
    setActiveLiveNodeIds([]);
    setLiveSelectedNodeId(null);
    setExecutionStatuses({});
    setActiveWorkflowId(workflow.id);
    setSelectedNodeId(workflow.nodes[0]?.id || null);
    setDesignerMode('diagram');
  };

  // Drop a document that was archived or deleted server-side from the local
  // workflow set, switching away from it when it was active.
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
      {/* Top Header */}
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

      {/* Main Studio Area */}
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
        {/* Left Sidebar — only visible in Designer view */}
        {currentView === 'designer' && (
          <Sidebar
            workflows={workflows}
            activeWorkflowId={activeWorkflowId}
            onSelectWorkflow={(id) => {
              setAuthoringCandidate(null);
              setSelectedLiveInstance(null);
              setLiveWorkflow(null);
              setActiveLiveNodeIds([]);
              setExecutionStatuses({});
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
              if (tab !== 'instances') {
                setSelectedLiveInstance(null);
                setLiveWorkflow(null);
                setActiveLiveNodeIds([]);
                setExecutionStatuses({});
              }
            }}
            selectedInstanceId={selectedLiveInstance?.id}
            onSelectInstance={(instance) => void openLiveInstance(instance)}
            instancesRefreshKey={instancesRefreshKey}
            treeRefreshKey={treeRefreshKey}
          />
        )}

        {/* View: Designer Canvas */}
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
                <span className="font-mono text-[10px] text-[#A89F91]">{selectedLiveInstance.id.slice(0, 8)}</span>
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
                    onRunAgentTest={handleRunAgentTest}
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
              onOverlayChange={(statuses, activeNodeId, running) => {
                setExecutionStatuses(statuses);
                setActiveSimulationNodeId(activeNodeId);
                setIsSimulating(running);
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

        {/* View: Task Inbox (Human-in-the-Loop) */}
        {currentView === 'inbox' && <TaskInbox projectId={activeProject?.id} />}

        {/* View: Process Instances Dashboard */}
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

      {/* New Process Canvas Modal */}
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

      {/* Process Details inspector modal — metadata payloads live here, not the header */}
      <ProcessDetailsModal
        workflow={currentWorkflow}
        isOpen={showProcessDetails}
        onClose={() => setShowProcessDetails(false)}
      />

      {/* Settings panel — Insight Engine and LLM provider configuration */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        definitionKey={currentWorkflow.processKey
          || currentWorkflow.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}
        projectId={activeProject?.id}
      />

      {/* AI Diff review — full-focus dialog; canvas stays clean until Approved */}
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
