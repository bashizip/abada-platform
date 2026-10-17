import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  Braces,
  CheckCircle2,
  Loader2,
  Pin,
  PinOff,
  Radio,
  RefreshCcw,
  X,
} from 'lucide-react';
import { ActivityHistoryDTO, EngineAPI, ProcessInstanceDTO, ProjectJob } from '@/api/engine';
import { AgentStepEvidence, EvidenceAPI } from '@/api/evidence';
import { WorkflowFile } from '@/types';
import { humanize, statusOf } from '@/lib/run/instanceFormat';
import {
  AuditTimeline,
  InfoRow,
  NodeTelemetry,
  VariablesTab,
} from '@/features/operations/instanceTelemetry';
import { INSPECTOR_PANEL_DEFAULT_WIDTH } from '@/lib/run/panelPrefs';

type InspectorTab = 'telemetry' | 'variables' | 'audit';

interface LiveInstanceInspectorProps {
  instance: ProcessInstanceDTO;
  workflow: WorkflowFile;
  projectId?: string;
  definitionVersion?: string;
  selectedNodeId: string | null;
  onClose: () => void;
  /** Inspector panel width (px) — resizable via the left-edge drag handle. */
  panelWidth: number;
  onPanelWidthChange: (width: number) => void;
  /** Docked beside the canvas (true) or floating over it (false). */
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  /** Opens a child instance an agent delegated to (its step links to it). */
  onOpenInstance?: (instanceId: string) => void;
}

/**
 * Right-side inspector shown while a live instance is open on the canvas.
 * Three tabs: node Telemetry (driven by the selected graph node), state
 * Variables and the chronological Audit Trail. Instance-wide lifecycle info
 * lives in the bottom InstanceOverviewBar instead.
 */
export const LiveInstanceInspector: React.FC<LiveInstanceInspectorProps> = ({
  instance,
  workflow,
  projectId,
  definitionVersion,
  selectedNodeId,
  onClose,
  panelWidth,
  onPanelWidthChange,
  pinned,
  onPinnedChange,
  onOpenInstance,
}) => {
  const [tab, setTab] = useState<InspectorTab>('telemetry');
  const [history, setHistory] = useState<ActivityHistoryDTO[]>([]);
  const [jobs, setJobs] = useState<ProjectJob[]>([]);
  const [variables, setVariables] = useState<Record<string, unknown> | null>(null);
  const [agentSteps, setAgentSteps] = useState<AgentStepEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const instanceId = instance.id;

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [hist, jobList, vars] = await Promise.all([
        EngineAPI.getInstanceHistory(instanceId, projectId),
        EngineAPI.getJobs(projectId),
        EngineAPI.getInstanceVariables(instanceId, projectId),
      ]);
      setHistory(hist);
      setJobs(jobList);
      setVariables(vars);
      // Summaries only; payloads stay behind the evidence-reader role.
      setAgentSteps(await EvidenceAPI.steps(projectId, instanceId).catch(() => []));
    } catch {
      // Keep the last snapshot; the next poll retries.
    } finally {
      setLoading(false);
    }
  }, [projectId, instanceId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const retryJob = async (job: ProjectJob) => {
    if (!projectId) return;
    try {
      await EngineAPI.retryJob(projectId, job.id, 1);
      setToast(`Retried job ${job.id.slice(0, 8)}`);
      void load();
    } catch (cause) {
      setToast(`Retry failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
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
        onPanelWidthChange(Math.min(760, Math.max(340, startWidth + delta)));
      },
      up: endResize,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', resizeHandlers.current.move);
    window.addEventListener('mouseup', resizeHandlers.current.up);
  };

  // Unmounting mid-drag (e.g. closing the panel) must release listeners and body styles.
  useEffect(() => endResize, [endResize]);

  const selectedNode = workflow.nodes.find((node) => node.id === selectedNodeId) ?? null;

  return (
    <aside
      style={{ width: panelWidth }}
      className={`flex flex-col border-l border-hairline bg-mocha text-linen ${
        pinned ? 'shrink-0' : 'absolute inset-y-0 right-0 z-40 shadow-warm-lg'
      }`}
    >
      {/* Resize handle — drag to resize, double-click to reset */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector panel"
        className="group absolute -left-1.5 top-0 z-20 h-full w-3 cursor-col-resize"
        onMouseDown={startResize}
        onDoubleClick={() => onPanelWidthChange(INSPECTOR_PANEL_DEFAULT_WIDTH)}
        title="Drag to resize · double-click to reset"
      >
        <div className="mx-auto h-full w-px bg-hairline transition-colors group-hover:bg-saffron" />
      </div>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline bg-charcoal/70 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="h-4 w-4 shrink-0 text-mineral-teal" />
          <h2 className="truncate text-sm font-bold tracking-wide">Instance Inspector</h2>
          {loading && <Loader2 className="h-3 w-3 animate-spin text-mineral-teal" />}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void load()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-sand transition-colors hover:bg-mocha-hover hover:text-linen"
            title="Refresh telemetry"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-sand transition-colors hover:bg-mocha-hover hover:text-linen"
            title="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-hairline bg-charcoal/60 p-1.5">
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
                ? 'border border-hairline bg-mocha text-linen'
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
            {item.id === 'audit' && history.length > 0 && (
              <span className="rounded-full bg-mineral-teal/20 px-1.5 text-[9px] text-mineral-teal">
                {history.length}
              </span>
            )}
          </button>
        ))}

        {/* Pin / float toggle */}
        <button
          type="button"
          onClick={() => onPinnedChange(!pinned)}
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

      {/* Tab body */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        {tab === 'telemetry' && (
          <div className="p-4">
            {selectedNode ? (
              <NodeTelemetry
                nodeId={selectedNode.id}
                workflow={workflow}
                history={history}
                jobs={jobs}
                variables={variables}
                onRetry={retryJob}
                projectId={projectId}
                agentSteps={agentSteps}
                instanceId={instanceId}
                onOpenInstance={onOpenInstance}
              />
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-hairline bg-charcoal p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sand">
                    <Activity className="h-3.5 w-3.5 text-mineral-teal" /> Instance state
                  </div>
                  <InfoRow label="Status">{statusOf(instance)}</InfoRow>
                  <InfoRow label="Current activity">
                    {instance.currentActivityId ? humanize(instance.currentActivityId) : '—'}
                  </InfoRow>
                  <InfoRow label="Definition">
                    {instance.processDefinitionName || instance.processDefinitionId}
                    {definitionVersion ? ` · v${definitionVersion}` : ''}
                  </InfoRow>
                  <InfoRow label="History events">{history.length}</InfoRow>
                  <InfoRow label="Incident jobs">{jobs.filter((job) => job.processInstanceId === instanceId).length}</InfoRow>
                </div>
                <p className="rounded-xl border border-dashed border-hairline bg-charcoal p-3 text-[11px] leading-relaxed text-sand">
                  Select a node on the graph to inspect its telemetry, AI attempt metadata and error state.
                  Instance-wide lifecycle details live in the bottom bar.
                </p>
              </div>
            )}
          </div>
        )}

        {tab === 'variables' && <VariablesTab variables={variables} />}

        {tab === 'audit' && <AuditTimeline history={history} />}
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-mocha px-4 py-2 text-xs font-medium text-linen shadow-warm-lg">
            <CheckCircle2 className="h-3.5 w-3.5 text-sage-green" /> {toast}
          </div>
        </div>
      )}
    </aside>
  );
};
