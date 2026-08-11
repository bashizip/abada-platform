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
  ProcessDefinitionDTO,
  ProcessInstanceDTO,
  ProjectJob,
} from '@/api/engine';
import { aplToWorkflow, parseAPLYaml } from '@/lib/apl/parser';
import { TooltipProvider, UITooltip } from '@/components/ui';
import { StatusBadge } from '@/features/operations/ProcessOperations';
import {
  deriveBusinessLabel,
  formatDuration,
  formatWhen,
  humanize,
  statusOf,
} from '@/lib/run/instanceFormat';
import {
  AuditTimeline,
  InfoRow,
  NodeTelemetry,
  VariablesTab,
} from '@/features/operations/instanceTelemetry';
import { buildExecutionTrace, deriveInstancePath } from '@/lib/run/instanceDetail';
import { INSPECTOR_PANEL_DEFAULT_WIDTH, useInspectorPanelPrefs } from '@/lib/run/panelPrefs';
import { WorkflowFile } from '@/types';

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

interface InstanceDetailViewProps {
  instanceId: string;
  projectId?: string;
  initialInstance: ProcessInstanceDTO;
  onBack: () => void;
  onOpenCanvas: (instance: ProcessInstanceDTO) => void;
}

type InspectorTab = 'telemetry' | 'variables' | 'audit';

export const InstanceDetailView: React.FC<InstanceDetailViewProps> = ({
  instanceId,
  projectId,
  initialInstance,
  onBack,
  onOpenCanvas,
}) => {
  const [instance, setInstance] = useState<ProcessInstanceDTO>(initialInstance);
  const [workflow, setWorkflow] = useState<WorkflowFile | null>(null);
  const [definition, setDefinition] = useState<ProcessDefinitionDTO | null>(null);
  const [activities, setActivities] = useState<ActivityInstanceDTO[]>([]);
  const [history, setHistory] = useState<ActivityHistoryDTO[]>([]);
  const [variables, setVariables] = useState<Record<string, unknown> | null>(null);
  const [jobs, setJobs] = useState<ProjectJob[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>('telemetry');
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
          setWorkflow(aplToWorkflow(parseAPLYaml(def.bpmnXml)));
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
    } catch {
      // Keep the last known snapshot; the next tick retries.
    }
  }, [projectId, instanceId]);

  useEffect(() => {
    void load(true);
    void loadVariablesAndJobs();
  }, [load, loadVariablesAndJobs]);

  /* ---- Poll while the instance is still advancing ---- */
  const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(statusOf(instance));
  useEffect(() => {
    if (isTerminal) return;
    const timer = window.setInterval(() => {
      void load(false);
      void loadVariablesAndJobs();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isTerminal, load, loadVariablesAndJobs]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /* ---- Keyboard: Esc back, arrows cycle nodes ---- */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'Escape') {
        onBack();
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
  const path = useMemo(() => {
    if (!workflow) return null;
    return deriveInstancePath(workflow, instance, activities, history);
  }, [workflow, instance, activities, history]);

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

  /* ------------------------------------------------------------------ */

  return (
    <TooltipProvider delayDuration={0}>
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#1A1614] text-[#EAE3D9]">
      {/* ===== Header bar ===== */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#3A322E] bg-[#25201D] px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg border border-[#3A322E] bg-[#1A1614] px-2.5 py-1.5 text-[11px] font-semibold text-[#A89F91] transition-all hover:border-[#4A403A] hover:text-[#EAE3D9]"
          title="Back to the instances list (Esc)"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Instances
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#9D4EDD]" />
            {label}
          </span>
          {source && <span className="hidden text-[10px] text-[#A89F91] sm:inline">business key</span>}
        </div>

        <div className="hidden min-w-0 items-center gap-1.5 lg:flex">
          <span className="truncate text-xs text-[#A89F91]">
            {instance.processDefinitionName || instance.processDefinitionId}
          </span>
          {definition && (
            <span className="rounded border border-[#9D4EDD]/30 bg-[#9D4EDD]/10 px-1.5 py-px text-[10px] font-medium text-[#9D4EDD]">
              v{definition.version}
            </span>
          )}
          <ChevronRight className="h-3 w-3 shrink-0 text-[#A89F91]" />
          <span className="font-mono text-[10px] text-[#A89F91]">{instance.id.slice(0, 12)}…</span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <StatusBadge instance={instance} />
          <span className="flex items-center gap-1.5 rounded-full border border-[#3A322E] bg-[#1A1614] px-2.5 py-1 font-mono text-[11px] tabular-nums text-[#A89F91]" title="Elapsed time">
            <Clock className="h-3 w-3 text-[#F4A261]" />
            {formatDuration(elapsedMs)}
          </span>

          <UITooltip content="Open on the canvas — read-only live graph with the instance details panel">
            <button
              type="button"
              onClick={() => onOpenCanvas(instance)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#3A322E] bg-[#1A1614] text-[#A89F91] transition-all hover:border-[#2A9D8F]/50 hover:text-[#2A9D8F]"
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
                  ? 'border-[#2A9D8F]/40 bg-[#2A9D8F]/10 text-[#2A9D8F] hover:bg-[#2A9D8F]/20'
                  : 'border-[#F4A261]/40 bg-[#F4A261]/10 text-[#F4A261] hover:bg-[#F4A261]/20'
              }`}
              title={status === 'SUSPENDED' ? 'Resume the instance' : 'Pause token advancement'}
            >
              {status === 'SUSPENDED'
                ? <><PlayCircle className="h-3.5 w-3.5" /> Resume</>
                : <><PauseCircle className="h-3.5 w-3.5" /> Suspend</>}
            </button>
          )}

          {status === 'RUNNING' && (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="flex items-center gap-1.5 rounded-lg border border-[#E76F51]/40 bg-[#E76F51]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#E76F51] transition-all hover:bg-[#E76F51]/20"
              title="Terminate the instance (audited)"
            >
              <XCircle className="h-3.5 w-3.5" /> Cancel
            </button>
          )}

          <button
            type="button"
            onClick={exportTrace}
            className="flex items-center gap-1.5 rounded-lg border border-[#3A322E] bg-[#1A1614] px-2.5 py-1.5 text-[11px] font-semibold text-[#A89F91] transition-all hover:border-[#9D4EDD]/50 hover:text-[#9D4EDD]"
            title="Export the full execution trace as JSON"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </div>

      {error && !loading && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#E76F51]/30 bg-[#E76F51]/10 px-4 py-2 text-[11px] text-[#E76F51]">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
          <button type="button" onClick={() => void load(true)} className="ml-auto font-semibold underline-offset-2 hover:underline">
            Retry
          </button>
        </div>
      )}

      {/* ===== Split workspace ===== */}
      <div className="relative flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="relative min-w-0 flex-1">
          {loading && !workflow ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-[#A89F91]">
              <Loader2 className="h-4 w-4 animate-spin text-[#9D4EDD]" /> Loading execution graph…
            </div>
          ) : workflow && path ? (
            <Canvas
              nodes={workflow.nodes}
              edges={workflow.edges}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => setSelectedNodeId(id)}
              onNodeMove={() => undefined}
              onDeleteNode={() => undefined}
              onConnectNodes={() => undefined}
              onAddNode={() => undefined}
              onOpenAplEditor={() => undefined}
              onFocusPrompt={() => undefined}
              isSimulating={false}
              activeSimulationNodeId={null}
              executionStatuses={path.statuses}
              activeLiveNodeIds={path.activeNodeIds}
              activePathEdges={path.activePathEdgeIds}
              readOnly
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-[#A89F91]">
              The immutable definition for this instance is unavailable.
            </div>
          )}

          {/* Legend */}
          {path && (
            <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex items-center gap-3 rounded-lg border border-[#3A322E] bg-[#25201D]/95 px-3 py-2 text-[10px] text-[#A89F91] shadow-warm-md">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#90A955]" /> Completed</span>
              <span className="flex items-center gap-1.5"><span className="relative flex h-2 w-2"><span className="absolute h-full w-full animate-ping rounded-full bg-[#9D4EDD] opacity-60" /><span className="relative h-2 w-2 rounded-full bg-[#9D4EDD]" /></span> Active</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#E76F51]" /> Failed</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#F4A261]" /> Waiting</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-[#9D4EDD]" /> Taken path</span>
            </div>
          )}
        </div>

        {/* ===== Inspector ===== */}
        <aside
          style={{ width: panelWidth }}
          className={`flex flex-col border-l border-[#3A322E] bg-[#25201D] ${
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
            <div className="mx-auto h-full w-px bg-[#3A322E] transition-colors group-hover:bg-[#F4A261]" />
          </div>
          {/* Tabs */}
          <div className="flex shrink-0 items-center gap-1 border-b border-[#3A322E] bg-[#1A1614]/60 p-1.5">
            {([
              { id: 'telemetry', label: 'Telemetry', icon: Bot },
              { id: 'variables', label: 'Variables', icon: Braces },
              { id: 'audit', label: 'Audit Trail', icon: Radio },
            ] as const).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-all ${
                  tab === item.id
                    ? 'bg-[#25201D] text-[#EAE3D9] border border-[#3A322E]'
                    : 'text-[#A89F91] hover:text-[#EAE3D9]'
                }`}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
                {item.id === 'variables' && variables && (
                  <span className="rounded-full bg-[#9D4EDD]/20 px-1.5 text-[9px] text-[#9D4EDD]">
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
                  ? 'border-[#2A9D8F]/40 bg-[#2A9D8F]/10 text-[#2A9D8F]'
                  : 'border-[#3A322E] bg-[#1A1614] text-[#A89F91] hover:border-[#4A403A] hover:text-[#EAE3D9]'
              }`}
              title={pinned
                ? 'Unpin — float the inspector over the canvas'
                : 'Pin — dock the inspector beside the canvas'}
            >
              {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
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
                    onRetry={retryJob}
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-[#3A322E] bg-[#1A1614] p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#A89F91]">
                        <Activity className="h-3.5 w-3.5 text-[#2A9D8F]" /> Instance overview
                      </div>
                      <InfoRow label="Status">
                        <span className="font-medium text-[#EAE3D9]">{status}</span>
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
                    <p className="rounded-xl border border-dashed border-[#3A322E] bg-[#1A1614] p-3 text-[11px] leading-relaxed text-[#A89F91]">
                      Select a node on the graph to inspect its telemetry, AI attempt metadata and error state.
                      Use <span className="font-mono text-[#F4A261]">←</span> / <span className="font-mono text-[#F4A261]">→</span> to navigate nodes.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ---------- Tab: Variables ---------- */}
            {tab === 'variables' && <VariablesTab variables={variables} />}

            {/* ---------- Tab: Audit trail ---------- */}
            {tab === 'audit' && <AuditTimeline history={history} />}
          </div>
        </aside>
      </div>

      {/* ===== Cancel confirm ===== */}
      {confirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={() => setConfirmCancel(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-[#3A322E] bg-[#25201D] p-5 shadow-warm-lg" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-[#E76F51]/30 bg-[#E76F51]/10">
              <AlertTriangle className="h-4 w-4 text-[#E76F51]" />
            </div>
            <h3 className="text-sm font-semibold text-[#EAE3D9]">Cancel instance</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[#A89F91]">
              Cancel <span className="font-semibold text-[#EAE3D9]">{label}</span>? This is terminal, audited, and cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="rounded-lg border border-[#3A322E] px-3 py-1.5 text-xs font-semibold text-[#A89F91] transition-colors hover:border-[#4A403A] hover:text-[#EAE3D9]"
              >
                Keep running
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmCancel(false);
                  void mutate(() => EngineAPI.cancelInstance(instance.id, projectId as string), `Cancelled ${label}`);
                }}
                className="rounded-lg bg-[#E76F51] px-3 py-1.5 text-xs font-semibold text-[#1A1614] transition-all hover:bg-[#f0896f] active:scale-95"
              >
                Cancel instance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Toast ===== */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 animate-rise">
          <div className="flex items-center gap-2 rounded-full border border-[#3A322E] bg-[#25201D] px-4 py-2 text-xs font-medium text-[#EAE3D9] shadow-warm-lg">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#90A955]" /> {toast}
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
};
