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
import { AIDiffModal } from '@/features/designer/AIDiffModal';
import { TaskInbox } from '@/features/inbox/TaskInbox';
import { ProcessOperations } from '@/features/operations/ProcessOperations';
import { RunPanel } from '@/features/run/RunPanel';
import { EngineAPI } from '@/api/engine';
import { InsightAPI } from '@/api/insight';
import { AplGenerationCandidate, AuthoringAPI } from '@/api/authoring';
import { Project, ProjectAPI } from '@/api/projects';
import { aplToWorkflow, parseAPLYaml, stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import { AplEditor } from '@/features/designer/AplEditor';
import { applyInstanceState, extractDecisionOutputs, mapTerminalStatus, sleep, RunResult } from '@/lib/run/liveRun';
import { autoLayoutWorkflow } from '@/lib/layout/autoLayout';
import { WorkflowDiffSnapshot } from '@/lib/aiDiff/types';
import { WorkflowFile, WorkflowNode, WorkflowEdge, NodeType, SimulationLog, AgentConfig, LANGUAGE_VERSION_ABADA_IO_V1 } from '@/types';

type StudioView = 'designer' | 'inbox' | 'operations';
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
  const [workflows, setWorkflows] = useState<WorkflowFile[]>([bootstrapWorkflow.current]);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>(bootstrapWorkflow.current.id);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [designerMode, setDesignerMode] = useState<DesignerMode>('diagram');
  const [authoringCandidate, setAuthoringCandidate] = useState<AuthoringCandidate | null>(null);
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<StudioView>('designer');
  
  // Simulation & Audit logs state
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationLogs, setSimulationLogs] = useState<SimulationLog[]>([]);
  const [showLogPanel, setShowLogPanel] = useState<boolean>(true);

  // Live engine run state
  const [showRunPanel, setShowRunPanel] = useState<boolean>(false);
  const [lastRunResult, setLastRunResult] = useState<RunResult | null>(null);

  // AI Diff review state (Insight Engine proposal preview)
  const [diffSnapshot, setDiffSnapshot] = useState<WorkflowDiffSnapshot | null>(null);
  const [showProcessDetails, setShowProcessDetails] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Workflow Generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | undefined>();
  const [showProjects, setShowProjects] = useState(false);
  const persistedFingerprint = useRef(new Map<string, string>());
  const failedAutosaveFingerprint = useRef(new Map<string, string>());
  const persistedProcessKeys = useRef(new Map<string, string>());
  const creatingWorkflowIds = useRef(new Set<string>());

  // Get active workflow object
  const currentWorkflow = workflows.find((w) => w.id === activeWorkflowId) || workflows[0];
  const selectedNode = currentWorkflow.nodes.find((n) => n.id === selectedNodeId) || null;

  const workflowFingerprint = (workflow: WorkflowFile) => JSON.stringify({
    processKey: workflow.processKey, name: workflow.name, description: workflow.description,
    category: workflow.category, nodes: workflow.nodes, edges: workflow.edges,
  });

  const openProject = async (project: Project) => {
    setAuthoringCandidate(null);
    setActiveProject(project);
    localStorage.setItem('abada.studio.projectId', project.id);
    const documents = await ProjectAPI.documents(project.id);
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
      const emptyWorkflow = createEmptyWorkflow(`draft-${project.id}`);
      setWorkflows([emptyWorkflow]);
      setActiveWorkflowId(emptyWorkflow.id);
      setSelectedNodeId(null);
    }
    setDesignerMode('diagram');
  };

  useEffect(() => {
    ProjectAPI.list().then((available) => {
      setProjects(available);
      const remembered = localStorage.getItem('abada.studio.projectId');
      const selected = available.find((project) => project.id === remembered) || available[0];
      if (selected) void openProject(selected);
      else setShowProjects(true);
    }).catch(() => setShowProjects(true));
    // Project discovery happens once per authenticated Studio session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeProject || currentWorkflow.nodes.length === 0) return;
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
        : ProjectAPI.createDocument(activeProject.id, workflowToSave, workflowToSave.description || '');
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
    if (laidOutWorkflowIds.current.has(activeWorkflowId)) return;
    laidOutWorkflowIds.current.add(activeWorkflowId);
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: autoLayoutWorkflow(wf.nodes, wf.edges),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkflowId]);

  // Helper to update active workflow nodes/edges
  const updateActiveWorkflow = (updater: (wf: WorkflowFile) => WorkflowFile) => {
    setWorkflows((prev) =>
      prev.map((wf) => (wf.id === activeWorkflowId ? updater(wf) : wf))
    );
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
    if (authoringCandidate && !authoringCandidate.replaceWorkflowId) {
      setWorkflows((items) => [appliedWorkflow, ...items]);
    } else {
      setWorkflows((items) => items.map((item) => item.id === targetId ? appliedWorkflow : item));
    }
    setActiveWorkflowId(appliedWorkflow.id);
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

  const handleAddNode = (type: NodeType) => {
    const id = `${type}-${Date.now()}`;
    const isFirstEvent = type === 'event'
      && !currentWorkflow.nodes.some((node) => node.type === 'event' && node.subtype === 'start');
    const defaultTitles: Record<NodeType, string> = {
      agent: 'AI Validation Agent',
      human: 'Executive Review Task',
      dmn: 'Risk Matrix Policy',
      gateway: 'Branching Gateway',
      event: isFirstEvent ? 'Start Process' : 'End Process',
    };

    const newNode: WorkflowNode = {
      id,
      type,
      subtype: type === 'event' ? (isFirstEvent ? 'start' : 'end') : undefined,
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

  // Open the live Run panel
  const handleOpenRunPanel = () => {
    setShowRunPanel(true);
    setShowLogPanel(true);
  };

  const handleOpenAiDiff = async () => {
    const definitionKey = currentWorkflow.processKey
      || currentWorkflow.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    try {
      const page = await InsightAPI.listProposals(definitionKey, activeProject?.id);
      const summary = page.items.find((item) => item.status === 'DRAFT' || item.status === 'IN_REVIEW');
      if (!summary) throw new Error(`No pending Insight proposal for ${definitionKey}`);
      setDiffSnapshot(InsightAPI.toDiffSnapshot(await InsightAPI.getProposal(summary.id, activeProject?.id)));
    } catch (error) {
      setSimulationLogs((prev) => [...prev, {
        id: `diff-error-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), nodeId: 'system',
        nodeTitle: 'Insight Engine', nodeType: 'event', status: 'warning',
        message: error instanceof Error ? error.message : String(error),
      }]);
      setShowLogPanel(true);
    }
  };

  const handleExitAiDiff = () => {
    setDiffSnapshot(null);
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

  // Live engine run: deploy-if-missing → start → poll → real decision outputs
  const handleRunLive = async (payload: Record<string, any>): Promise<RunResult> => {
    if (isSimulating) {
      throw new Error('A run is already in progress.');
    }

    const wf = currentWorkflow;
    const startedAt = Date.now();
    const timestamp = () => new Date().toLocaleTimeString();
    const addLog = (log: Omit<SimulationLog, 'id' | 'timestamp'>) => {
      setSimulationLogs((prev) => [
        ...prev,
        {
          ...log,
          id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: timestamp(),
        },
      ]);
    };

    setIsSimulating(true);
    setShowLogPanel(true);
    setShowRunPanel(true);

    const processKey = wf.processKey
      || wf.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || `process_${Date.now()}`;
    let version = 0;

    try {
      // 1. Deploy canonical APL. The engine reuses an identical checksum and
      // creates a new immutable version when the source changed.
      addLog({
        nodeId: 'system', nodeTitle: 'Deployment Compiler', nodeType: 'event', status: 'info',
        message: `Validating and deploying native APL [${wf.name}] as definition [${processKey}]…`,
      });
      let deployWorkflow = wf;
      if (activeProject) {
        const wasDraft = !wf.documentId;
        const saved = wf.documentId ? await ProjectAPI.saveDocument(activeProject.id, wf)
          : await ProjectAPI.createDocument(activeProject.id, wf, wf.description || '');
        deployWorkflow = { ...wf, id: saved.id, documentId: saved.id, revision: saved.revision };
        persistedFingerprint.current.set(deployWorkflow.id, workflowFingerprint(deployWorkflow));
        setWorkflows((items) => items.map((item) => item.id === wf.id ? deployWorkflow : item));
        if (wasDraft) setActiveWorkflowId(saved.id);
      }
      const deploy = activeProject
        ? await ProjectAPI.deployDocument(activeProject.id, deployWorkflow)
        : await EngineAPI.deployWorkflow(wf);
      version = deploy.version;
      addLog({
        nodeId: 'system', nodeTitle: 'Abada Engine', nodeType: 'event', status: 'success',
        message: `Deployed native APL [${deploy.processDefinitionId}] v${deploy.version} · deployment ${deploy.deploymentId}.`,
      });

      // 2. Start an instance with the supplied payload
      addLog({
        nodeId: 'system', nodeTitle: 'Process Runner', nodeType: 'event', status: 'info',
        message: `Starting instance with payload ${JSON.stringify(payload)}…`,
      });
      const { processInstanceId } = await EngineAPI.startProcess(processKey, payload, activeProject?.id);
      addLog({
        nodeId: 'system', nodeTitle: 'Process Runner', nodeType: 'event', status: 'success',
        message: `Instance started: ${processInstanceId}.`,
      });

      // 3. Poll until terminal state, a human gate, or a 45s timeout
      let instance = await EngineAPI.getInstance(processInstanceId, activeProject?.id);
      let outputs = extractDecisionOutputs(wf, instance.variables || {});
      let waitingTaskName: string | undefined;
      let pollCount = 0;
      const deadline = Date.now() + 45_000;

      while (true) {
        const terminal = instance.status.toUpperCase();
        if (terminal === 'COMPLETED' || terminal === 'FAILED' || terminal === 'CANCELLED') break;

        const outputsNow = extractDecisionOutputs(wf, instance.variables || {});
        for (const out of outputsNow) {
          if (outputs.some((o) => o.decisionKey === out.decisionKey)) continue;
          addLog({
            nodeId: out.nodeId, nodeTitle: out.nodeTitle, nodeType: 'dmn', status: 'success',
            message: `Decision table [${out.decisionKey}] applied in-transaction — outputs written to instance variables.`,
            outputs: Object.entries(out.outputs).map(([name, value]) => ({ name, value: String(value) })),
          });
        }
        outputs = outputsNow;

        // Waiting on a human task visible to the current user?
        // (engine task name = BPMN userTask name = node description; tasks endpoint
        // only returns tasks assigned to or claimable by the authenticated user)
        if (pollCount % 3 === 0) {
          try {
            const tasks = await EngineAPI.getTasks('AVAILABLE');
            const waiting = tasks.find((t: any) =>
              wf.nodes.some((n) => n.type === 'human' && (n.description || n.title) === t.name)
            );
            if (waiting) {
              waitingTaskName = waiting.name;
              break;
            }
          } catch {
            // task polling is best-effort
          }
        }
        pollCount++;

        if (Date.now() > deadline) break;
        await sleep(1500);
        instance = await EngineAPI.getInstance(processInstanceId, activeProject?.id);
      }

      // 4. Final snapshot
      instance = await EngineAPI.getInstance(processInstanceId, activeProject?.id);
      outputs = extractDecisionOutputs(wf, instance.variables || {});
      const terminal = instance.status.toUpperCase();
      const durationMs = Date.now() - startedAt;

      // Reflect real engine state on the canvas (only if the same workflow is still active)
      if (activeWorkflowId === wf.id) {
        const statuses = applyInstanceState(wf, instance, waitingTaskName);
        updateActiveWorkflow((w) => ({
          ...w,
          nodes: w.nodes.map((n) => ({ ...n, status: statuses[n.id] || 'idle' })),
        }));
      }

      if (terminal === 'COMPLETED') {
        addLog({
          nodeId: 'end', nodeTitle: 'Run Concluded', nodeType: 'event', status: 'success',
          message: `Instance COMPLETED in ${(durationMs / 1000).toFixed(1)}s with ${outputs.length} decision table(s) applied.`,
        });
      } else if (terminal === 'FAILED' || terminal === 'CANCELLED') {
        addLog({
          nodeId: 'end', nodeTitle: 'Run Failed', nodeType: 'event', status: 'error',
          message: `Instance ended with status ${terminal}. Inspect engine logs or the Operations view.`,
        });
      } else if (waitingTaskName) {
        addLog({
          nodeId: 'system', nodeTitle: 'Process Runner', nodeType: 'human', status: 'warning',
          message: `Instance ACTIVE — waiting on human task [${waitingTaskName}]. Complete it from the Task Inbox.`,
        });
      } else {
        addLog({
          nodeId: 'system', nodeTitle: 'Process Runner', nodeType: 'event', status: 'warning',
          message: 'Instance ACTIVE — the flow has paused awaiting a human task or an external agent worker. Open the Task Inbox or Operations to monitor.',
        });
      }

      const result: RunResult = {
        instanceId: processInstanceId,
        processDefinitionId: processKey,
        version,
        status: mapTerminalStatus(terminal),
        waitingAt: waitingTaskName,
        durationMs,
        decisionOutputs: outputs,
        variables: instance.variables || {},
      };
      setLastRunResult(result);
      return result;
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      addLog({
        nodeId: 'system', nodeTitle: 'Run Error', nodeType: 'event', status: 'error',
        message: `Run failed: ${message}`,
      });
      const result: RunResult = {
        instanceId: '',
        processDefinitionId: processKey,
        version,
        status: 'FAILED',
        durationMs: Date.now() - startedAt,
        decisionOutputs: [],
        variables: {},
        error: message,
      };
      setLastRunResult(result);
      return result;
    } finally {
      setIsSimulating(false);
    }
  };

  // Deploy to Abada Engine
  const handleDeploy = async () => {
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
              currentWorkflow.description || '');
        deployWorkflow = { ...currentWorkflow, id: saved.id, documentId: saved.id,
          revision: saved.revision, updatedAt: saved.updatedAt };
        persistedFingerprint.current.set(deployWorkflow.id, workflowFingerprint(deployWorkflow));
        setWorkflows((items) => items.map((item) => item.id === currentWorkflow.id
          ? deployWorkflow : item));
        if (wasDraft) setActiveWorkflowId(saved.id);
      }
      const response = activeProject
        ? await ProjectAPI.deployDocument(activeProject.id, deployWorkflow)
        : await EngineAPI.deployWorkflow(currentWorkflow);
      
      setSimulationLogs(prev => [
        ...prev,
        {
          id: `deploy-${Date.now()}-2`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Abada Engine',
          nodeType: 'event',
          status: 'success',
          message: `Deployment successful! Process Definition: [${response.processDefinitionId}], Version: ${response.version}, Deployment ID: ${response.deploymentId}`,
        }
      ]);
    } catch (err: any) {
      setSimulationLogs(prev => [
        ...prev,
        {
          id: `deploy-${Date.now()}-err`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Deployment Error',
          nodeType: 'event',
          status: 'error',
          message: `Failed to deploy: ${err.message}`,
        }
      ]);
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

  // Create Custom Workflow File
  const handleCreateNewWorkflow = (name: string, category: WorkflowFile['category']) => {
    const processKey = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || `process_${Date.now()}`;
    const draft = createEmptyWorkflow(`draft-${Date.now()}`, name, processKey, category);
    setWorkflows((prev) => [draft, ...prev.filter((item) => !item.id.startsWith('draft-'))]);
    setAuthoringCandidate(null);
    setActiveWorkflowId(draft.id);
    setSelectedNodeId(null);
    setDesignerMode('diagram');
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#1A1614] text-[#EAE3D9] overflow-hidden">
      {/* Top Header */}
      <Header
        currentWorkflow={currentWorkflow}
        onRunSimulation={handleOpenRunPanel}
        isSimulating={isSimulating}
        onNewWorkflow={() => setIsNewModalOpen(true)}
        onExportJSON={handleExportJSON}
        onDeploy={handleDeploy}
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
      />

      {/* Main Studio Area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar — only visible in Designer view */}
        {currentView === 'designer' && (
          <Sidebar
            workflows={workflows}
            activeWorkflowId={activeWorkflowId}
            onSelectWorkflow={(id) => {
              setAuthoringCandidate(null);
              setActiveWorkflowId(id);
              const wf = workflows.find((w) => w.id === id);
              if (wf && wf.nodes.length > 0) setSelectedNodeId(wf.nodes[0].id);
            }}
            onAddNode={handleAddNode}
            onNewWorkflowModal={() => setIsNewModalOpen(true)}
            projectId={activeProject?.id}
          />
        )}

        {/* View: Designer Canvas */}
        {currentView === 'designer' && (
          <>
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 rounded-xl border border-[#3A322E] bg-[#25201D]/95 p-1 shadow-warm-md">
              <button onClick={() => setDesignerMode('diagram')}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${designerMode === 'diagram' ? 'bg-[#F4A261] text-[#1A1614]' : 'text-[#A89F91] hover:text-[#EAE3D9]'}`}>
                Diagram
              </button>
              <button onClick={() => setDesignerMode('apl')}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${designerMode === 'apl' ? 'bg-[#2A9D8F] text-[#101816]' : 'text-[#A89F91] hover:text-[#EAE3D9]'}`}>
                APL YAML
              </button>
            </div>

            {designerMode === 'diagram' ? (
              <>
                <Canvas
                  key={currentWorkflow.id}
                  nodes={currentWorkflow.nodes}
                  edges={currentWorkflow.edges}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                  onNodeMove={handleNodeMove}
                  onConnectNodes={handleConnectNodes}
                  onAutoLayout={handleAutoLayout}
                  onAddNode={handleAddNode}
                  onOpenAplEditor={() => setDesignerMode('apl')}
                  onFocusPrompt={() => document.getElementById('workflow-prompt')?.focus()}
                  isSimulating={false}
                  activeSimulationNodeId={null}
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
                  hasActiveWorkflow={workflows.length > 0}
                />
              </>
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

            <RunPanel
              workflow={currentWorkflow}
              isOpen={showRunPanel}
              isRunning={isSimulating}
              onClose={() => setShowRunPanel(false)}
              onRun={handleRunLive}
              lastResult={lastRunResult}
            />

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

        {/* View: Process Operations */}
        {currentView === 'operations' && <ProcessOperations projectId={activeProject?.id} />}
      </div>

      {/* New Process Canvas Modal */}
      <NewWorkflowModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreateWorkflow={handleCreateNewWorkflow}
      />

      <ProjectDialog isOpen={showProjects} projects={projects} activeProject={activeProject}
        onClose={() => setShowProjects(false)} onOpen={(project) => void openProject(project)}
        onCreated={(project) => { setProjects((items) => [project, ...items]); void openProject(project); }} />

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
    </div>
  );
}
