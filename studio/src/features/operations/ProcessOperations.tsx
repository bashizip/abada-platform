import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { EngineAPI, IncidentDTO, ProcessDefinitionDTO, ProcessInstanceDTO } from '@/api/engine';
import { Drawer, TooltipProvider } from '@/components/ui';
import { useInstanceEvents } from '@/hooks/useInstanceEvents';
import { countPerHour } from '@/lib/run/kpiBuckets';
import { deriveBusinessLabel, humanize, statusOf } from '@/lib/run/instanceFormat';
import { IncidentsPanel } from './IncidentsPanel';
import { VersionsPanel } from './VersionsPanel';
import { VariablesPanel } from './VariablesPanel';
import { ConfirmDialog, ConfirmRequest } from './ConfirmDialog';
import { OperationsToast } from './OperationsToast';
import { useOperationsNotice } from './useOperationsNotice';
import { KpiBand } from './overview/KpiBand';
import { AttentionBand } from './overview/AttentionBand';
import { FilterChips } from './overview/FilterChips';
import { DEFAULT_FILTERS, OverviewFilters, overviewMemory as remembered } from './overview/filters';
import { InstanceList } from './overview/InstanceList';
import type { RowAction } from './overview/InstanceRow';
import { useInstanceList } from './overview/useInstanceList';
import { useOperationsKpis } from './overview/useOperationsKpis';
import { useProjectIncidents, useWorkerHealth } from './overview/useProjectHealth';
import { useOverviewRows } from './overview/useOverviewRows';

/**
 * Operations (M5 S6): the headline numbers, what needs attention, and every
 * instance of the project, live from the event stream with polling as a
 * fallback. Each part lives in `overview/`.
 */
export const ProcessOperations: React.FC<{
  projectId?: string;
  /** Project OPERATOR or OWNER: may retry incidents and suspend, cancel or fail instances (the engine enforces it too). */
  canRetryIncidents?: boolean;
  /** Project operator, maintainer or owner: may roll a process back to an earlier version. */
  canRollBack?: boolean;
  onOpenInstance?: (instance: ProcessInstanceDTO) => void;
  onOpenDetail?: (instance: ProcessInstanceDTO) => void;
  /** Opens an incident's instance focused on its step (M5 S4). */
  onOpenIncident?: (incident: IncidentDTO) => void;
  /** Shown on the empty project: go and deploy something. */
  onOpenDesigner?: () => void;
}> = ({ projectId, canRetryIncidents = false, canRollBack = false, onOpenInstance, onOpenDetail, onOpenIncident, onOpenDesigner }) => {
  if (remembered.projectId !== projectId) Object.assign(remembered, { projectId, filters: DEFAULT_FILTERS, cursorId: undefined });
  const [filters, setFilters] = useState<OverviewFilters>(remembered.filters);
  const [definitions, setDefinitions] = useState<ProcessDefinitionDTO[]>([]);
  const [liveTick, setLiveTick] = useState(0);
  const [drawer, setDrawer] = useState<'incidents' | 'versions' | null>(null);
  const [variablesFor, setVariablesFor] = useState<ProcessInstanceDTO | null>(null);
  const [variables, setVariables] = useState<Record<string, unknown> | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [notice, setNotice] = useOperationsNotice();
  const searchRef = useRef<HTMLInputElement>(null);

  const list = useInstanceList(projectId, filters);
  const { refresh: refreshList } = list;
  const stream = useInstanceEvents(projectId, undefined, useCallback(() => setLiveTick((tick) => tick + 1), []));
  const kpis = useOperationsKpis(projectId, liveTick);
  const { incidents, loading: incidentsLoading, refresh: refreshIncidents } = useProjectIncidents(projectId, liveTick);
  const { workers, loading: workersLoading } = useWorkerHealth(projectId);

  useEffect(() => { remembered.filters = filters; }, [filters]);
  useEffect(() => { if (liveTick > 0) refreshList(); }, [liveTick, refreshList]);
  useEffect(() => {
    // With the stream live, polling is only a safety net.
    const timer = window.setInterval(refreshList, stream === 'live' ? 60_000 : 15_000);
    return () => window.clearInterval(timer);
  }, [stream, refreshList]);

  useEffect(() => {
    setDefinitions([]);
    if (!projectId) return;
    EngineAPI.getProcessDefinitions(projectId).then(setDefinitions).catch(() => setDefinitions([]));
  }, [projectId]);

  const { rows, processOf } = useOverviewRows(list.instances, definitions, filters);
  const [cursor, setCursor] = useState(0);
  const restored = useRef(false);
  useEffect(() => {
    // Back from an instance: put the cursor on the row the user left from.
    if (restored.current || rows.length === 0) return;
    restored.current = true;
    const index = rows.findIndex((row) => row.id === remembered.cursorId);
    if (index > 0) setCursor(index);
  }, [rows]);
  useEffect(() => {
    // Recorded only once the list is there, so the first empty render cannot forget the row.
    if (restored.current && rows[cursor]) remembered.cursorId = rows[cursor].id;
  }, [rows, cursor]);
  const changeFilters = (next: OverviewFilters) => { setFilters(next); setCursor(0); };

  const incidentInstanceIds = useMemo(() => new Set(incidents.map((incident) => incident.processInstanceId)), [incidents]);
  const incidentSeries = useMemo(() => countPerHour(incidents.map((incident) => incident.createdAt), Date.now()), [incidents]);
  const decisions = incidents.filter((incident) => incident.type === 'TOOL_OUTCOME_UNKNOWN').length;
  const processKeys = useMemo(() => [...new Set(definitions.map((definition) => definition.id))].sort(), [definitions]);
  const instanceProcess = useCallback((instanceId: string) => {
    const instance = list.instances.find((item) => item.id === instanceId);
    return instance ? processOf(instance).name : null;
  }, [list.instances, processOf]);

  const mutate = useCallback(async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      setNotice({ message: done });
      refreshList();
    } catch (cause) {
      setNotice({ message: `${done} — failed: ${cause instanceof Error ? cause.message : String(cause)}`, tone: 'error' });
    }
  }, [refreshList, setNotice]);

  const onAction = useCallback((action: RowAction, instance: ProcessInstanceDTO, index: number) => {
    const project = projectId as string;
    const { label } = deriveBusinessLabel(instance);
    setCursor(index);
    if (action === 'open') onOpenDetail?.(instance);
    else if (action === 'canvas') onOpenInstance?.(instance);
    else if (action === 'variables') {
      setVariablesFor(instance);
      setVariables(null);
      EngineAPI.getInstanceVariables(instance.id, project).then(setVariables)
        .catch((cause) => setVariables({ error: cause instanceof Error ? cause.message : String(cause) }));
    } else if (action === 'resume') {
      void mutate(() => EngineAPI.setInstanceSuspension(instance.id, project, false), `Resumed ${label}`);
    } else if (action === 'suspend') {
      setConfirm({ title: 'Suspend instance', confirmLabel: 'Suspend',
        message: `Suspend ${label}? No step advances until it is resumed.`,
        onConfirm: () => void mutate(() => EngineAPI.setInstanceSuspension(instance.id, project, true), `Suspended ${label}`) });
    } else if (action === 'cancel') {
      setConfirm({ title: 'Cancel instance', confirmLabel: 'Cancel instance', danger: true,
        message: `Cancel ${label}? It stops for good. This is recorded in the audit trail and cannot be undone.`,
        onConfirm: () => void mutate(() => EngineAPI.cancelInstance(instance.id, project), `Cancelled ${label}`) });
    } else if (action === 'fail') {
      setConfirm({ title: 'Force fail instance', confirmLabel: 'Force fail', danger: true,
        message: `Force ${label} into the failed state? Use it only for a stuck run that must not continue.`,
        onConfirm: () => void mutate(() => EngineAPI.failInstance(instance.id, project), `Failed ${label}`) });
    }
  }, [projectId, onOpenDetail, onOpenInstance, mutate]);

  const filtered = filters.status !== 'ALL' || filters.definitionId !== 'ALL' || filters.version !== 'ALL'
    || filters.range !== 'ALL' || filters.search.trim() !== '';
  const emptyProject = !list.loading && !filtered && list.total === 0 && definitions.length === 0;
  const running = rows.filter((row) => statusOf(row) === 'RUNNING').length;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-full w-full flex-col overflow-y-auto bg-charcoal text-linen">
        <div className="flex flex-col gap-4 px-6 pb-3 pt-5">
          <header className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-linen">Operations</h1>
              <p className="text-xs text-sand">Every running and recent instance of this project, as it happens.</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span title={stream === 'live' ? 'Updates arrive from the project event stream' : 'The event stream is not available; refreshing every 15 s'}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${stream === 'live'
                  ? 'border-mineral-teal/40 text-mineral-teal-bright' : 'border-hairline text-sand'}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${stream === 'live' ? 'bg-mineral-teal abada-live-outline' : 'bg-sand'}`} />
                {stream === 'live' ? 'Live' : 'Polling'}
              </span>
              <button type="button" onClick={() => setDrawer('versions')} disabled={processKeys.length === 0}
                className="flex items-center gap-1.5 rounded-control border border-hairline bg-charcoal px-3 py-1.5 text-xs font-medium text-sand transition-colors hover:border-hairline-strong hover:text-linen disabled:opacity-50">
                <History className="h-3.5 w-3.5" aria-hidden="true" /> Versions &amp; rollback
              </button>
            </div>
          </header>
          <KpiBand kpis={kpis} openIncidents={incidents.length} incidentSeries={incidentSeries} decisions={decisions} />
          <AttentionBand incidents={incidents} incidentsLoading={incidentsLoading} workers={workers} workersLoading={workersLoading}
            processName={instanceProcess} onOpenIncident={onOpenIncident} onShowAllIncidents={() => setDrawer('incidents')} />
          {!emptyProject && (
            <FilterChips filters={filters} onChange={changeFilters} counts={kpis.stateCounts} definitions={definitions} searchRef={searchRef} />
          )}
          <div className="flex items-center justify-between text-[11px] text-sand" aria-live="polite">
            <span>
              Showing <b className="font-semibold tabular-nums text-linen">{rows.length.toLocaleString()}</b> of{' '}
              <b className="font-semibold tabular-nums text-linen">{list.instances.length.toLocaleString()}</b> loaded
              {list.total > list.instances.length && <> · {list.total.toLocaleString()} match on the server</>}
              {running > 0 && <> · {running} running</>}
            </span>
            {list.error && <span className="text-desert-rose">{list.error}</span>}
          </div>
        </div>
        <div className="flex min-h-[420px] flex-1 flex-col px-6 pb-6">
          <InstanceList rows={rows} loading={list.loading} loadingMore={list.loadingMore} hasMore={list.hasMore}
            onLoadMore={list.loadMore} emptyProject={emptyProject} filtered={filtered} cursor={Math.min(cursor, Math.max(0, rows.length - 1))}
            onCursorChange={setCursor} processOf={processOf} incidentInstanceIds={incidentInstanceIds}
            canOperate={canRetryIncidents} onAction={onAction} onSearch={() => searchRef.current?.focus()}
            emptyAction={onOpenDesigner && (
              <button type="button" onClick={onOpenDesigner}
                className="rounded-control bg-saffron px-3 py-1.5 text-xs font-semibold text-charcoal hover:bg-saffron-bright">
                Open the designer
              </button>
            )} />
        </div>

        <Drawer open={drawer === 'incidents'} onClose={() => setDrawer(null)} title="Open incidents" width={520}>
          <IncidentsPanel projectId={projectId} canRetry={canRetryIncidents} incidents={incidents} embedded
            onOpenIncident={onOpenIncident} onRetried={(incident) => {
              setNotice({ message: `Retried ${humanize(incident.activityId)}` });
              refreshIncidents();
              refreshList();
            }} />
        </Drawer>
        <Drawer open={drawer === 'versions'} onClose={() => setDrawer(null)} title="Versions and rollback" width={520}>
          <VersionsPanel projectId={projectId} processKeys={processKeys} canRollBack={canRollBack} embedded
            onRolledBack={(key, version) => setNotice({ message: `Rolled ${humanize(key)} back to v${version}` })} />
        </Drawer>
        <Drawer open={variablesFor !== null} onClose={() => setVariablesFor(null)}
          title={variablesFor ? `Variables · ${deriveBusinessLabel(variablesFor).label}` : 'Variables'}>
          <VariablesPanel variables={variables} resetKey={variablesFor?.id} projectId={projectId} />
        </Drawer>
        <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
        <OperationsToast notice={notice} onDismiss={() => setNotice(null)} />
      </div>
    </TooltipProvider>
  );
};
