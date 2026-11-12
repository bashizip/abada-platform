import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { EngineAPI, IncidentDTO, ProcessInstanceDTO, ProjectJob } from '@/api/engine';
import { TooltipProvider } from '@/components/ui';
import { useInstancePlayback } from '@/hooks/useInstancePlayback';
import { useInstanceIncidents } from '@/hooks/useInstanceIncidents';
import { PACE_DWELL_MS } from '@/lib/run/playbackPace';
import { deriveBusinessLabel, humanize, statusOf } from '@/lib/run/instanceFormat';
import { LiveAuditTrail } from './LiveAuditTrail';
import { LineagePanel } from './LineagePanel';
import { VersionsPanel } from './VersionsPanel';
import { ErrorDetailsDialog } from './ErrorDetailsDialog';
import { NodeTelemetry } from './instanceTelemetry';
import { VariablesPanel } from './VariablesPanel';
import type { FailureDetails } from './NodeIncidentCard';
import { useNodeIncidents } from './useNodeIncidents';
import { ConfirmDialog, ConfirmRequest } from './ConfirmDialog';
import { OperationsToast } from './OperationsToast';
import { useOperationsNotice } from './useOperationsNotice';
import { useInstanceData } from './instance/useInstanceData';
import { InstanceHeader } from './instance/InstanceHeader';
import { InstanceStage } from './instance/InstanceStage';
import { DrawerTab, InstanceDrawer } from './instance/InstanceDrawer';
import { AuditTrailColumn } from './instance/AuditTrailColumn';

interface InstanceDetailViewProps {
  instanceId: string;
  projectId?: string;
  /** Project OPERATOR or OWNER: may retry incidents, suspend and cancel (the engine enforces it too). */
  canRetryIncidents?: boolean;
  /** Project operator, maintainer or owner: may roll the process back. */
  canRollBack?: boolean;
  initialInstance: ProcessInstanceDTO;
  /** Where Back returns to, named on the button. */
  backLabel?: string;
  onBack: () => void;
  onOpenCanvas: (instance: ProcessInstanceDTO) => void;
  /** Opens a related instance (a caller or a called process). */
  onOpenInstance?: (instanceId: string) => void;
  /** Opened from an incident: focus this step and open its incident card (M5 S4). */
  initialFocusNodeId?: string;
  /** The user just started this instance from the Studio: play it from its first fact (M5 S5). */
  playFromStart?: boolean;
}

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return !!element && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
};

/**
 * One instance (M5 S6): a sticky header, the canvas as the hero playing the
 * run back, the live audit trail on the right and the details in a drawer.
 * Esc closes the incident card, then the drawer, then goes back.
 */
export const InstanceDetailView: React.FC<InstanceDetailViewProps> = ({
  instanceId, projectId, canRetryIncidents = false, canRollBack = false, initialInstance, backLabel = 'Operations', onBack, onOpenCanvas,
  onOpenInstance, initialFocusNodeId, playFromStart = false,
}) => {
  const openIncidents = useInstanceIncidents(projectId, instanceId, 0);
  const data = useInstanceData(projectId, instanceId, initialInstance, openIncidents.refresh);
  const { instance, workflow, history, isTerminal, load, refresh } = data;
  const incidentNodeIds = useMemo(
    () => [...new Set(openIncidents.incidents.map((incident) => incident.activityId))].sort(),
    [openIncidents.incidents],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab | null>(null);
  const [trailHoverNodeId, setTrailHoverNodeId] = useState<string | null>(null);
  const [trailFilterNodeId, setTrailFilterNodeId] = useState<string | null>(null);
  const [auditHighlight, setAuditHighlight] = useState<string | null>(null);
  const [failureDetails, setFailureDetails] = useState<FailureDetails | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [notice, setNotice] = useOperationsNotice();
  const { label } = deriveBusinessLabel(instance);
  const status = statusOf(instance);
  const nodeTitle = useCallback((nodeId: string) =>
    workflow?.nodes.find((node) => node.id === nodeId)?.title ?? humanize(nodeId), [workflow]);

  useEffect(() => {
    if (workflow) setSelectedNodeId((current) => current ?? instance.currentActivityId ?? null);
  }, [workflow, instance.currentActivityId]);

  /* The canvas plays the instance back one flow at a time (S3); the panels keep the real facts. */
  const playback = useInstancePlayback(workflow, instance, data.activities, history, incidentNodeIds, { fromStart: playFromStart });
  const onResolved = useCallback((nodeId: string, historyId: string | undefined) => {
    setNotice({
      message: `Resolved — ${nodeTitle(nodeId)} completed after the retry`,
      action: historyId ? { label: 'View in audit trail', run: () => { setTrailFilterNodeId(null); setAuditHighlight(historyId); } } : undefined,
    });
  }, [nodeTitle, setNotice]);
  const nodeIncidents = useNodeIncidents({
    workflow, incidents: openIncidents.incidents, incidentsLoaded: !openIncidents.loading,
    visibleHistory: playback.frame?.history ?? [], history, historyLoaded: !data.loading,
    activities: playback.frame?.activities ?? [], dwellMs: PACE_DWELL_MS[playback.pace], initialFocusNodeId, onResolved,
  });

  const incidentRetried = (incident: IncidentDTO) => {
    nodeIncidents.retried(incident);
    openIncidents.drop(incident.id);
    refresh();
  };

  const mutate = async (action: () => Promise<unknown>, done: string) => {
    if (!projectId) return;
    try {
      await action();
      setNotice({ message: done });
      refresh();
    } catch (cause) {
      setNotice({ message: `${done} — failed: ${cause instanceof Error ? cause.message : String(cause)}`, tone: 'error' });
    }
  };
  const askCancel = () => setConfirm({
    title: 'Cancel instance', confirmLabel: 'Cancel instance', danger: true,
    message: <>Cancel <span className="font-semibold text-linen">{label}</span>? It stops for good. This is recorded in the audit trail and cannot be undone.</>,
    onConfirm: () => void mutate(() => EngineAPI.cancelInstance(instance.id, projectId as string), `Cancelled ${label}`),
  });
  const retryJob = async (job: ProjectJob) => {
    if (projectId) await mutate(() => EngineAPI.retryJob(projectId, job.id, 1), `Retried job ${job.id.slice(0, 8)} — back to ${humanize(job.activityId)}`);
  };

  /* Keyboard: Esc closes the incident card, then the drawer, then goes back; ←/→ walk the steps. */
  const escape = useRef<() => void>(() => undefined);
  useEffect(() => {
    escape.current = () => {
      if (nodeIncidents.cardNodeId) nodeIncidents.closeCard();
      else if (drawerTab) setDrawerTab(null);
      else onBack();
    };
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTyping(event.target) || document.querySelector('[aria-modal="true"]')) return;
      if (event.key === 'Escape') {
        escape.current();
      } else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && workflow?.nodes.length) {
        event.preventDefault();
        const ordered = [...workflow.nodes].sort((a, b) => a.x - b.x);
        setSelectedNodeId((current) => {
          const index = ordered.findIndex((node) => node.id === current);
          return ordered[(index + (event.key === 'ArrowRight' ? 1 : -1) + ordered.length) % ordered.length].id;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [workflow]);

  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const drawerTitle = drawerTab === 'step' ? (selectedNode?.title ?? 'Step')
    : drawerTab === 'variables' ? 'Variables'
      : drawerTab === 'lineage' ? 'Lineage' : `Versions of ${instance.processDefinitionName || humanize(instance.processDefinitionId)}`;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-charcoal text-linen">
        <InstanceHeader instance={instance} definition={data.definition} isTerminal={isTerminal} live={data.live}
          incidents={openIncidents.incidents} nodeTitle={nodeTitle} playback={playback} canOperate={canRetryIncidents}
          backLabel={backLabel} onBack={onBack} onOpenCanvas={() => onOpenCanvas(instance)} onOpenIncident={nodeIncidents.openCard}
          onToggleSuspend={() => void mutate(
            () => EngineAPI.setInstanceSuspension(instance.id, projectId as string, status !== 'SUSPENDED'),
            status === 'SUSPENDED' ? `Resumed ${label}` : `Suspended ${label}`)}
          onCancel={askCancel} onExport={data.exportTrace} />

        {data.error && !data.loading && (
          <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-desert-rose/30 bg-desert-rose/10 px-4 py-2 text-[11px] text-desert-rose">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {data.error}
            <button type="button" onClick={() => void load(true)} className="ml-auto font-semibold underline-offset-2 hover:underline">Try again</button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 max-md:flex-col">
          <div className="relative min-h-[360px] min-w-0 flex-1">
            <InstanceStage projectId={projectId} instance={instance} isTerminal={isTerminal} loading={data.loading}
              workflow={workflow} frame={playback.frame} history={history} animateArrivals={playback.pace !== 'instant'}
              nodeIncidents={nodeIncidents} canAct={canRetryIncidents} selectedNodeId={selectedNodeId}
              onSelectNode={(id) => {
                setSelectedNodeId(id);
                setTrailFilterNodeId(id);
                if (id && nodeIncidents.incidentAt[id]) nodeIncidents.openCard(id);
              }}
              highlightNodeId={trailHoverNodeId} onRetried={incidentRetried} onViewDetails={setFailureDetails}
              onCancelInstance={askCancel} />
            <InstanceDrawer tab={drawerTab} onTabChange={setDrawerTab} title={drawerTitle}
              variableCount={data.variables ? Object.keys(data.variables).length : undefined}>
              {drawerTab === 'step' && (selectedNode && workflow ? (
                <NodeTelemetry nodeId={selectedNode.id} workflow={workflow} history={history}
                  jobs={data.jobs.filter((job) => job.processInstanceId === instanceId)} variables={data.variables}
                  onRetry={canRetryIncidents ? retryJob : undefined} projectId={projectId} agentSteps={data.agentSteps}
                  instanceId={instanceId} onOpenInstance={onOpenInstance} />
              ) : (
                <p className="py-2 text-xs text-sand">Select a step on the diagram, or walk the steps with ← and →.</p>
              ))}
              {drawerTab === 'variables' && (
                <VariablesPanel variables={data.variables} visibleFacts={playback.frame?.history} lag={playback.lag}
                  onJumpToNow={playback.jumpToNow} resetKey={instanceId} projectId={projectId} />
              )}
              {drawerTab === 'lineage' && <LineagePanel projectId={projectId} instanceId={instanceId} onOpenInstance={onOpenInstance} embedded />}
              {drawerTab === 'versions' && (
                <VersionsPanel projectId={projectId} processKeys={[instance.processDefinitionId]} canRollBack={canRollBack}
                  instanceVersion={data.definition?.version} embedded
                  onRolledBack={(_, version) => setNotice({ message: `Rolled back to v${version}. This instance stays on its version.` })} />
              )}
            </InstanceDrawer>
          </div>
          <AuditTrailColumn>
            <LiveAuditTrail className="flex-1" history={playback.trail} workflow={workflow} agentSteps={data.agentSteps}
              projectId={projectId} instanceId={instanceId} onOpenInstance={onOpenInstance} highlightId={auditHighlight}
              filterNodeId={trailFilterNodeId} onClearFilter={() => setTrailFilterNodeId(null)} onHoverNode={setTrailHoverNodeId} />
          </AuditTrailColumn>
        </div>

        <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
        {failureDetails && projectId && (
          <ErrorDetailsDialog projectId={projectId} jobId={failureDetails.jobId} context={failureDetails.context}
            onClose={() => setFailureDetails(null)} />
        )}
        <OperationsToast notice={notice} onDismiss={() => setNotice(null)} />
      </div>
    </TooltipProvider>
  );
};
