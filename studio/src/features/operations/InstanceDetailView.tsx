import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Braces,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Loader2,
  PauseCircle,
  Pin,
  PinOff,
  PlayCircle,
  Radio,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Canvas } from '@/features/designer/Canvas';
import {
  ActivityHistoryDTO,
  ActivityInstanceDTO,
  EngineAPI,
  IncidentDTO,
  ProcessDefinitionDTO,
  ProcessInstanceDTO,
  ProjectJob,
} from '@/api/engine';
import { aplToWorkflow, parseAPLYaml } from '@/lib/apl/parser';
import { useInstanceEvents } from '@/hooks/useInstanceEvents';
import { useInstancePlayback } from '@/hooks/useInstancePlayback';
import { PlaybackControl } from '@/components/PlaybackControl';
import { applyPreferredLayout } from '@/lib/run/layoutPrefs';
import { TooltipProvider, UITooltip } from '@/components/ui';
import { StatusBadge } from '@/features/operations/ProcessOperations';
import { IncidentsPanel } from '@/features/operations/IncidentsPanel';
import { NodeIncidentCard, RetryProgress, type FailureDetails } from '@/features/operations/NodeIncidentCard';
import { ErrorDetailsDialog } from '@/features/operations/ErrorDetailsDialog';
import { useNodeIncidents } from '@/features/operations/useNodeIncidents';
import { useInstanceIncidents } from '@/hooks/useInstanceIncidents';
import { PACE_DWELL_MS } from '@/lib/run/playbackPace';
import { LineagePanel } from '@/features/operations/LineagePanel';
import { AgentStepEvidence, EvidenceAPI } from '@/api/evidence';
import { agentStepModel } from '@/lib/run/incidents';
import {
  deriveBusinessLabel,
  formatDuration,
  formatWhen,
  humanize,
  statusOf,
} from '@/lib/run/instanceFormat';
import { LiveAuditTrail } from '@/features/operations/LiveAuditTrail';
import {
  InfoRow,
  NodeTelemetry,
  VariablesTab,
} from '@/features/operations/instanceTelemetry';
import { buildExecutionTrace, deriveInstancePath, InstancePath } from '@/lib/run/instanceDetail';
import { INSPECTOR_PANEL_DEFAULT_WIDTH, useInspectorPanelPrefs } from '@/lib/run/panelPrefs';
import { WorkflowFile } from '@/types';

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

interface InstanceDetailViewProps {
  instanceId: string;
  projectId?: string;
  /** Project OPERATOR or OWNER: may retry incidents (the engine enforces it too). */
  canRetryIncidents?: boolean;
  initialInstance: ProcessInstanceDTO;
  onBack: () => void;
  onOpenCanvas: (instance: ProcessInstanceDTO) => void;
  /** Opens a related instance (a caller or a called process). */
  onOpenInstance?: (instanceId: string) => void;
  /** Opened from an incident: focus this step and open its incident card (M5 S4). */
  initialFocusNodeId?: string;
  /** The user just started this instance from the Studio: play it from its first fact (M5 S5). */
  playFromStart?: boolean;
}

type InspectorTab = 'telemetry' | 'variables' | 'audit';

export const InstanceDetailView: React.FC<InstanceDetailViewProps> = ({
  instanceId,
  projectId,
  canRetryIncidents = false,
  initialInstance,
  onBack,
  onOpenCanvas,
  onOpenInstance,
  initialFocusNodeId,
  playFromStart = false,
}) => {
  const [instance, setInstance] = useState<ProcessInstanceDTO>(initialInstance);
  const [workflow, setWorkflow] = useState<WorkflowFile | null>(null);
  const [definition, setDefinition] = useState<ProcessDefinitionDTO | null>(null);
  const [activities, setActivities] = useState<ActivityInstanceDTO[]>([]);
  /* Open incidents of this instance, refreshed with the event stream (M5 S4). */
  const openIncidents = useInstanceIncidents(projectId, instanceId, 0);
  const incidentNodeIds = useMemo(
    () => [...new Set(openIncidents.incidents.map((incident) => incident.activityId))].sort(),
    [openIncidents.incidents],
  );
  const [failureDetails, setFailureDetails] = useState<FailureDetails | null>(null);
  const [toastAudit, setToastAudit] = useState<string | null>(null);
  const [auditHighlight, setAuditHighlight] = useState<string | null>(null);
  const [history, setHistory] = useState<ActivityHistoryDTO[]>([]);
  const [variables, setVariables] = useState<Record<string, unknown> | null>(null);
  const [jobs, setJobs] = useState<ProjectJob[]>([]);
  const [agentSteps, setAgentSteps] = useState<AgentStepEvidence[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // The audit trail tells the run as it happens, so it is what the inspector opens on (M5 S5).
  const [tab, setTab] = useState<InspectorTab>('audit');
  /** The node of the trail entry under the pointer: ringed on the canvas. */
  const [trailHoverNodeId, setTrailHoverNodeId] = useState<string | null>(null);
  /** The trail shows only this node's entries; set by clicking a node on the canvas. */
  const [trailFilterNodeId, setTrailFilterNodeId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  // Inspector width + pin state are shared with the live canvas view and
  // persist across reloads (see lib/run/panelPrefs).
  const { panelWidth, setPanelWidth, pinned, setPinned } = useInspectorPanelPrefs();

  /* ---- Live elapsed ticker ---- */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* ---- Core load: instance + activities + history (definition on first) ---- */
  const load = useCallback(async (fresh: boolean) => {
    if (!projectId) return;
    try {
      setError(null);
      const [inst, act, hist] = await Promise.all([
        EngineAPI.getInstance(instanceId, projectId),
        EngineAPI.getActivityInstances(instanceId, projectId),
        EngineAPI.getInstanceHistory(instanceId, projectId),
      ]);
      setInstance(inst);
      setActivities(act);
      setHistory(hist);
      if (fresh) {
        const def = await EngineAPI.getDefinitionForInstance(inst, projectId);
        setDefinition(def);
        if (def?.schemaType === 'APL_NATIVE' && def.bpmnXml) {
          let wf = aplToWorkflow(parseAPLYaml(def.bpmnXml));
          wf = { ...wf, nodes: applyPreferredLayout(inst.processDefinitionId, wf.nodes) };
          setWorkflow(wf);
          setSelectedNodeId((current) => current ?? inst.currentActivityId ?? null);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId, instanceId]);

  /* ---- Variables + jobs (slower live refresh) ---- */
  const loadVariablesAndJobs = useCallback(async () => {
    if (!projectId) return;
    try {
      const [vars, jobList] = await Promise.all([
        EngineAPI.getInstanceVariables(instanceId, projectId),
        EngineAPI.getJobs(projectId),
      ]);
      setVariables(vars);
      setJobs(jobList);
      setAgentSteps(await EvidenceAPI.steps(projectId, instanceId).catch(() => []));
    } catch {
      // Keep the last known snapshot; the next tick retries.
    }
  }, [projectId, instanceId]);

  useEffect(() => {
    void load(true);
    void loadVariablesAndJobs();
  }, [load, loadVariablesAndJobs]);

  /* ---- Live while the instance is still advancing: the event stream, polling as the fallback ---- */
  const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(statusOf(instance));
  const refreshIncidents = openIncidents.refresh;
  const refresh = useCallback(() => {
    void load(false);
    void loadVariablesAndJobs();
    refreshIncidents();
  }, [load, loadVariablesAndJobs, refreshIncidents]);
  const streamState = useInstanceEvents(isTerminal ? undefined : projectId, instanceId, refresh);
  const live = streamState === 'live';
  useEffect(() => {
    if (isTerminal) return;
    // With the stream live, polling is only a safety net.
    const timer = window.setInterval(refresh, live ? 15_000 : 2000);
    return () => window.clearInterval(timer);
  }, [isTerminal, live, refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => { setToast(null); setToastAudit(null); }, toastAudit ? 6000 : 3200);
    return () => window.clearTimeout(timer);
  }, [toast, toastAudit]);

  /** Closes the open incident card; false when none is open. */
  const closeIncidentCard = useRef<(() => boolean) | null>(null);

  /* ---- Keyboard: Esc closes the incident card, then goes back; arrows cycle nodes ---- */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'Escape') {
        // The incident card closes first; the next Esc goes back.
        if (!closeIncidentCard.current?.()) onBack();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        if (!workflow || workflow.nodes.length === 0) return;
        const ordered = [...workflow.nodes].sort((a, b) => a.x - b.x);
        const index = ordered.findIndex((node) => node.id === selectedNodeId);
        const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + ordered.length) % ordered.length;
        setSelectedNodeId(ordered[next].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onBack, workflow, selectedNodeId]);

  /* ---- Derived overlay + path ---- */
  // The canvas plays the instance back one flow at a time (M5 S3); the panels keep the real facts.
  const playback = useInstancePlayback(workflow, instance, activities, history, incidentNodeIds,
    { fromStart: playFromStart });
  const frame = playback.frame;
  const onResolved = useCallback((nodeId: string, historyId: string | undefined) => {
    const title = workflow?.nodes.find((node) => node.id === nodeId)?.title ?? humanize(nodeId);
    setToast(`Resolved — ${title} completed after the retry`);
    setToastAudit(historyId ?? null);
  }, [workflow]);
  const nodeIncidents = useNodeIncidents({
    workflow,
    incidents: openIncidents.incidents,
    incidentsLoaded: !openIncidents.loading,
    visibleHistory: frame?.history ?? [],
    history,
    historyLoaded: !loading,
    activities: frame?.activities ?? [],
    dwellMs: PACE_DWELL_MS[playback.pace],
    initialFocusNodeId,
    onResolved,
  });
  const canvasIncidentNodeIds = nodeIncidents.incidentNodeIds;
  const { cardNodeId, closeCard } = nodeIncidents;
  useEffect(() => {
    closeIncidentCard.current = () => {
      if (!cardNodeId) return false;
      closeCard();
      return true;
    };
  }, [cardNodeId, closeCard]);
  const path = useMemo(() => {
    if (!workflow || !frame) return null;
    return deriveInstancePath(workflow, frame.instance, frame.activities, frame.history,
      { incidentNodeIds: canvasIncidentNodeIds });
  }, [workflow, frame, canvasIncidentNodeIds]);

  const incidentRetried = (incident: IncidentDTO) => {
    nodeIncidents.retried(incident);
    openIncidents.drop(incident.id);
    void load(false);
    void loadVariablesAndJobs();
    openIncidents.refresh();
  };

  /**
   * Content-stable projection of the path: polls return new object identities
   * for the same engine facts, and the daily tick re-renders this view. A
   * stable identity keeps the Canvas edge components memoized so the SVG
   * token motion (SMIL) never restarts while the instance facts are unchanged.
   */
  const stablePathCache = useRef<{ serialized: string | null; value: InstancePath | null }>({
    serialized: null,
    value: null,
  });
  const stablePath = useMemo(() => {
    const serialized = JSON.stringify(path);
    if (stablePathCache.current.serialized === serialized) return stablePathCache.current.value;
    stablePathCache.current = { serialized, value: path };
    return stablePathCache.current.value;
  }, [path]);

  /* ---- Actions ---- */
  const mutate = async (action: () => Promise<void>, message: string) => {
    if (!projectId) return;
    try {
      await action();
      setToast(message);
      void load(false);
      void loadVariablesAndJobs();
    } catch (cause) {
      setToast(`${message} — failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const exportTrace = () => {
    const payload = buildExecutionTrace(instance, definition, activities, history, variables, jobs);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `execution-trace-${instance.id.slice(0, 8)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const retryJob = async (job: ProjectJob) => {
    if (!projectId) return;
    await mutate(
      () => EngineAPI.retryJob(projectId, job.id, 1),
      `Retried job ${job.id.slice(0, 8)} — back to ${humanize(job.activityId)}`,
    );
  };

  /* ---- Inspector resize (drag the left-edge handle) ---- */
  const resizeHandlers = useRef<{ move: (event: MouseEvent) => void; up: () => void } | null>(null);

  const endResize = useCallback(() => {
    if (!resizeHandlers.current) return;
    window.removeEventListener('mousemove', resizeHandlers.current.move);
    window.removeEventListener('mouseup', resizeHandlers.current.up);
    resizeHandlers.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    resizeHandlers.current = {
      move: (moveEvent: MouseEvent) => {
        // Moving left widens the panel; moving right narrows it.
        const delta = startX - moveEvent.clientX;
        setPanelWidth(Math.min(760, Math.max(340, startWidth + delta)));
      },
      up: endResize,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', resizeHandlers.current.move);
    window.addEventListener('mouseup', resizeHandlers.current.up);
  };

  // Unmounting mid-drag (e.g. Esc → back) must release listeners and body styles.
  useEffect(() => endResize, [endResize]);

  /* ---- Derived display data ---- */
  const { label, source } = deriveBusinessLabel(instance);
  const status = statusOf(instance);
  const elapsedMs = instance.endDate
    ? new Date(instance.endDate).getTime() - new Date(instance.startDate).getTime()
    : Math.max(0, now - new Date(instance.startDate).getTime());
  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId) ?? null;

  const failedJobs = jobs.filter((job) => job.processInstanceId === instanceId);

  /* ---- The card on the failing node (M5 S4) ---- */
  const cardNode = nodeIncidents.cardNodeId
    ? workflow?.nodes.find((node) => node.id === nodeIncidents.cardNodeId) ?? null : null;
  const cardIncident = cardNode ? nodeIncidents.incidentAt[cardNode.id] : undefined;
  const cardPhase = cardNode ? nodeIncidents.retryPhases[cardNode.id] : undefined;
  const incidentOverlay = !cardNode || !projectId ? null
    : cardPhase && cardPhase !== 'failed'
      ? { nodeId: cardNode.id, content: <RetryProgress node={cardNode} phase={cardPhase} /> }
      : cardIncident && workflow ? {
        nodeId: cardNode.id,
        content: (
          <NodeIncidentCard
            key={cardIncident.id}
            projectId={projectId}
            incident={cardIncident}
            node={cardNode}
            history={history}
            canAct={canRetryIncidents}
            model={agentStepModel(workflow, cardNode.id, history)}
            onRetried={incidentRetried}
            onViewDetails={setFailureDetails}
            onCancelInstance={() => setConfirmCancel(true)}
            onClose={nodeIncidents.closeCard}
          />
        ),
      } : null;

  /* ------------------------------------------------------------------ */

  return (
    <TooltipProvider delayDuration={0}>
    <div className="flex h-full w-full flex-col overflow-hidden bg-charcoal text-linen">
      {/* ===== Header bar ===== */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-mocha px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg border border-hairline bg-charcoal px-2.5 py-1.5 text-[11px] font-semibold text-sand transition-all hover:border-hairline-strong hover:text-linen"
          title="Back to the instances list (Esc)"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Instances
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-amethyst" />
            {label}
          </span>
          {source && <span className="hidden text-[10px] text-sand sm:inline">business key</span>}
        </div>

        <div className="hidden min-w-0 items-center gap-1.5 lg:flex">
          <span className="truncate text-xs text-sand">
            {instance.processDefinitionName || instance.processDefinitionId}
          </span>
          {definition && (
            <span className="rounded border border-amethyst/30 bg-amethyst/10 px-1.5 py-px text-[10px] font-medium text-amethyst">
              v{definition.version}
            </span>
          )}
          <ChevronRight className="h-3 w-3 shrink-0 text-sand" />
          <span className="font-mono text-[10px] text-sand">{instance.id.slice(0, 12)}…</span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {(!isTerminal || playback.lag > 0) && (
            <PlaybackControl pace={playback.pace} onPaceChange={playback.setPace} lag={playback.lag}
              onJumpToNow={playback.jumpToNow} />
          )}
          <StatusBadge instance={instance} />
          {!isTerminal && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] ${live
                ? 'border-mineral-teal/40 text-mineral-teal' : 'border-hairline text-sand'}`}
              title={live ? 'Updates arrive from the event stream' : 'The event stream is not available; refreshing every 2 s'}
            >
              {live ? 'Live' : 'Polling'}
            </span>
          )}
          <span className="flex items-center gap-1.5 rounded-full border border-hairline bg-charcoal px-2.5 py-1 font-mono text-[11px] tabular-nums text-sand" title="Elapsed time">
            <Clock className="h-3 w-3 text-saffron" />
            {formatDuration(elapsedMs)}
          </span>

          <UITooltip content="Open on the canvas — read-only live graph with the instance details panel">
            <button
              type="button"
              onClick={() => onOpenCanvas(instance)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-charcoal text-sand transition-all hover:border-mineral-teal/50 hover:text-mineral-teal"
              title="Open on canvas"
            >
              <Activity className="h-3.5 w-3.5" />
            </button>
          </UITooltip>

          {(status === 'RUNNING' || status === 'SUSPENDED') && (
            <button
              type="button"
              onClick={() => void mutate(
                () => EngineAPI.setInstanceSuspension(instance.id, projectId as string, status !== 'SUSPENDED'),
                status === 'SUSPENDED' ? `Resumed ${label}` : `Suspended ${label}`,
              )}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all ${
                status === 'SUSPENDED'
                  ? 'border-mineral-teal/40 bg-mineral-teal/10 text-mineral-teal hover:bg-mineral-teal/20'
                  : 'border-saffron/40 bg-saffron/10 text-saffron hover:bg-saffron/20'
              }`}
              title={status === 'SUSPENDED' ? 'Resume the instance' : 'Pause token advancement'}
            >
              {status === 'SUSPENDED'
                ? <><PlayCircle className="h-3.5 w-3.5" /> Resume</>
                : <><PauseCircle className="h-3.5 w-3.5" /> Suspend</>}
            </button>
          )}

          {status === 'RUNNING' && canRetryIncidents && (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="flex items-center gap-1.5 rounded-lg border border-desert-rose/40 bg-desert-rose/10 px-2.5 py-1.5 text-[11px] font-semibold text-desert-rose transition-all hover:bg-desert-rose/20"
              title="Terminate the instance (audited)"
            >
              <XCircle className="h-3.5 w-3.5" /> Cancel
            </button>
          )}

          <button
            type="button"
            onClick={exportTrace}
            className="flex items-center gap-1.5 rounded-lg border border-hairline bg-charcoal px-2.5 py-1.5 text-[11px] font-semibold text-sand transition-all hover:border-amethyst/50 hover:text-amethyst"
            title="Export the full execution trace as JSON"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </div>

      {error && !loading && (
        <div className="flex shrink-0 items-center gap-2 border-b border-desert-rose/30 bg-desert-rose/10 px-4 py-2 text-[11px] text-desert-rose">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
          <button type="button" onClick={() => void load(true)} className="ml-auto font-semibold underline-offset-2 hover:underline">
            Retry
          </button>
        </div>
      )}

      {/* ===== Open incidents of this instance ===== */}
      <IncidentsPanel
        projectId={projectId}
        instanceId={instanceId}
        canRetry={canRetryIncidents}
        modelFor={workflow ? (incident) => agentStepModel(workflow, incident.activityId, history) : undefined}
        incidents={openIncidents.incidents}
        hideWhenEmpty
        onOpenIncident={workflow ? (incident) => nodeIncidents.openCard(incident.activityId) : undefined}
        onRetried={incidentRetried}
      />

      {/* ===== Call-process lineage ===== */}
      <LineagePanel projectId={projectId} instanceId={instanceId} onOpenInstance={onOpenInstance} />

      {/* ===== Split workspace ===== */}
      <div className="relative flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="relative min-w-0 flex-1">
          {loading && !workflow ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-sand">
              <Loader2 className="h-4 w-4 animate-spin text-amethyst" /> Loading execution graph…
            </div>
          ) : workflow && stablePath ? (
            <Canvas
              nodes={workflow.nodes}
              edges={workflow.edges}
              layoutPending={workflow.layoutPending}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => {
                setSelectedNodeId(id);
                setTrailFilterNodeId(id);
                if (id && nodeIncidents.incidentAt[id]) nodeIncidents.openCard(id);
              }}
              onNodeMove={() => undefined}
              onDeleteNode={() => undefined}
              onConnectNodes={() => undefined}
              onAddNode={() => undefined}
              onOpenAplEditor={() => undefined}
              onFocusPrompt={() => undefined}
              isSimulating={false}
              activeSimulationNodeId={null}
              executionStatuses={stablePath.statuses}
              activeLiveNodeIds={stablePath.activeNodeIds}
              activePathEdges={stablePath.activePathEdgeIds}
              activeTokenEdges={instance.suspended || isTerminal ? undefined : stablePath.tokenEdgeIds}
              nextPathEdges={instance.suspended || isTerminal ? undefined : stablePath.nextEdgeIds}
              path={stablePath.path}
              animateArrivals={playback.pace !== 'instant'}
              incidentPulses={nodeIncidents.incidentPulses}
              retryPhases={nodeIncidents.retryPhases}
              highlightNodeId={tab === 'audit' ? trailHoverNodeId : null}
              focus={nodeIncidents.focus}
              nodeOverlay={incidentOverlay}
              readOnly
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-sand">
              The immutable definition for this instance is unavailable.
            </div>
          )}

        </div>

        {/* ===== Inspector ===== */}
        <aside
          style={{ width: panelWidth }}
          className={`flex flex-col border-l border-hairline bg-mocha ${
            pinned ? 'relative shrink-0' : 'absolute inset-y-0 right-0 z-30 shadow-warm-lg'
          }`}
        >
          {/* Resize handle — drag to resize, double-click to reset */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector panel"
            className="group absolute -left-1.5 top-0 z-20 h-full w-3 cursor-col-resize"
            onMouseDown={startResize}
            onDoubleClick={() => setPanelWidth(INSPECTOR_PANEL_DEFAULT_WIDTH)}
            title="Drag to resize · double-click to reset"
          >
            <div className="mx-auto h-full w-px bg-hairline transition-colors group-hover:bg-saffron" />
          </div>
          {/* Tabs */}
          <div className="flex shrink-0 items-center gap-1 border-b border-hairline bg-charcoal/60 p-1.5">
            {([
              { id: 'audit', label: 'Audit Trail', icon: Radio },
              { id: 'telemetry', label: 'Telemetry', icon: Bot },
              { id: 'variables', label: 'Variables', icon: Braces },
            ] as const).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-all ${
                  tab === item.id
                    ? 'bg-mocha text-linen border border-hairline'
                    : 'text-sand hover:text-linen'
                }`}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
                {item.id === 'variables' && variables && (
                  <span className="rounded-full bg-amethyst/20 px-1.5 text-[9px] text-amethyst">
                    {Object.keys(variables).length}
                  </span>
                )}
              </button>
            ))}

            {/* Pin / float toggle */}
            <button
              type="button"
              onClick={() => setPinned((value) => !value)}
              aria-pressed={pinned}
              aria-label={pinned
                ? 'Unpin — float the inspector over the canvas'
                : 'Pin — dock the inspector beside the canvas'}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-all ${
                pinned
                  ? 'border-mineral-teal/40 bg-mineral-teal/10 text-mineral-teal'
                  : 'border-hairline bg-charcoal text-sand hover:border-hairline-strong hover:text-linen'
              }`}
              title={pinned
                ? 'Unpin — float the inspector over the canvas'
                : 'Pin — dock the inspector beside the canvas'}
            >
              {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* ---------- Tab: Audit trail (live, in step with the canvas) ---------- */}
          {tab === 'audit' && (
            <LiveAuditTrail
              className="flex-1"
              history={playback.trail}
              workflow={workflow}
              agentSteps={agentSteps}
              projectId={projectId}
              instanceId={instanceId}
              onOpenInstance={onOpenInstance}
              highlightId={auditHighlight}
              filterNodeId={trailFilterNodeId}
              onClearFilter={() => setTrailFilterNodeId(null)}
              onHoverNode={setTrailHoverNodeId}
            />
          )}

          <div className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain ${tab === 'audit' ? 'hidden' : ''}`}>
            {/* ---------- Tab: Telemetry ---------- */}
            {tab === 'telemetry' && (
              <div className="p-4">
                {selectedNode && workflow ? (
                  <NodeTelemetry
                    nodeId={selectedNode.id}
                    workflow={workflow}
                    history={history}
                    jobs={failedJobs}
                    variables={variables}
                    onRetry={canRetryIncidents ? retryJob : undefined}
                    projectId={projectId}
                    agentSteps={agentSteps}
                    instanceId={instanceId}
                    onOpenInstance={onOpenInstance}
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-hairline bg-charcoal p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sand">
                        <Activity className="h-3.5 w-3.5 text-mineral-teal" /> Instance overview
                      </div>
                      <InfoRow label="Status">
                        <span className="font-medium text-linen">{status}</span>
                      </InfoRow>
                      <InfoRow label="Current activity">
                        {instance.currentActivityId ? humanize(instance.currentActivityId) : '—'}
                      </InfoRow>
                      <InfoRow label="Duration">{formatDuration(elapsedMs)}</InfoRow>
                      <InfoRow label="Started">{formatWhen(instance.startDate)}</InfoRow>
                      <InfoRow label="Started by">{instance.startedBy || 'system'}</InfoRow>
                      {instance.endDate && <InfoRow label="Ended">{formatWhen(instance.endDate)}</InfoRow>}
                      <InfoRow label="History events">{history.length}</InfoRow>
                      <InfoRow label="Incident jobs">{failedJobs.length}</InfoRow>
                    </div>
                    <p className="rounded-xl border border-dashed border-hairline bg-charcoal p-3 text-[11px] leading-relaxed text-sand">
                      Select a node on the graph to inspect its telemetry, AI attempt metadata and error state.
                      Use <span className="font-mono text-saffron">←</span> / <span className="font-mono text-saffron">→</span> to navigate nodes.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ---------- Tab: Variables ---------- */}
            {tab === 'variables' && <VariablesTab variables={variables} />}

          </div>
        </aside>
      </div>

      {/* ===== Cancel confirm ===== */}
      {confirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={() => setConfirmCancel(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-hairline bg-mocha p-5 shadow-warm-lg" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-desert-rose/30 bg-desert-rose/10">
              <AlertTriangle className="h-4 w-4 text-desert-rose" />
            </div>
            <h3 className="text-sm font-semibold text-linen">Cancel instance</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-sand">
              Cancel <span className="font-semibold text-linen">{label}</span>? This is terminal, audited, and cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-semibold text-sand transition-colors hover:border-hairline-strong hover:text-linen"
              >
                Keep running
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmCancel(false);
                  void mutate(() => EngineAPI.cancelInstance(instance.id, projectId as string), `Cancelled ${label}`);
                }}
                className="rounded-lg bg-desert-rose px-3 py-1.5 text-xs font-semibold text-charcoal transition-all hover:bg-desert-rose-bright active:scale-95"
              >
                Cancel instance
              </button>
            </div>
          </div>
        </div>
      )}

      {failureDetails && projectId && (
        <ErrorDetailsDialog
          projectId={projectId}
          jobId={failureDetails.jobId}
          context={failureDetails.context}
          onClose={() => setFailureDetails(null)}
        />
      )}

      {/* ===== Toast ===== */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 animate-rise">
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-mocha px-4 py-2 text-xs font-medium text-linen shadow-warm-lg">
            <CheckCircle2 className="h-3.5 w-3.5 text-sage-green" /> {toast}
            {toastAudit && (
              <button
                type="button"
                onClick={() => {
                  setTab('audit');
                  setTrailFilterNodeId(null);
                  setAuditHighlight(toastAudit);
                  setToast(null);
                  setToastAudit(null);
                }}
                className="ml-1 font-semibold text-saffron underline-offset-2 hover:underline"
              >
                View in audit trail
              </button>
            )}
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
};
