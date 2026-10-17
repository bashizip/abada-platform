import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Braces,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Gauge,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCcw,
  Search,
  Sparkles,
  Terminal,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  EngineAPI,
  IncidentDTO,
  ProcessDefinitionDTO,
  ProcessInstanceDTO,
} from '@/api/engine';
import { TooltipProvider, UITooltip } from '@/components/ui';
import { WorkerHealthPanel } from './WorkerHealthPanel';
import { IncidentsPanel } from './IncidentsPanel';
import { VersionsPanel } from './VersionsPanel';
import {
  InstanceStatus,
  STATUS_META,
  deriveBusinessLabel,
  formatDuration,
  formatWhen,
  humanize,
  instanceDurationMs,
  statusOf,
  unwrapVariable,
} from '@/lib/run/instanceFormat';

const mergeUnique = (preferred: ProcessInstanceDTO[], extra: ProcessInstanceDTO[]): ProcessInstanceDTO[] => {
  const seen = new Set(preferred.map((item) => item.id));
  return [...preferred, ...extra.filter((item) => !seen.has(item.id))];
};

const cleanKey = (key: string): string => key.replace(/^process[:_]/, '');

/* ------------------------------------------------------------------ */
/* Sub components                                                      */
/* ------------------------------------------------------------------ */

export const StatusBadge: React.FC<{ instance: ProcessInstanceDTO }> = ({ instance }) => {
  const status = statusOf(instance);
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide ${meta.chip} ${meta.text}`}>
      <span className="relative flex h-1.5 w-1.5">
        {status === 'RUNNING' && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${meta.dot}`} />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      </span>
      {meta.label}
    </span>
  );
};

const KpiCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent: string;
  live?: boolean;
  alert?: boolean;
}> = ({ icon, label, value, hint, accent, live = false, alert = false }) => (
  <div className={`group relative overflow-hidden rounded-xl border bg-mocha p-4 transition-all duration-300 hover:-translate-y-0.5 ${
    live ? 'border-mineral-teal/40 shadow-warm-md' : alert ? 'border-desert-rose/40 shadow-warm-md' : 'border-hairline hover:border-hairline-strong'
  }`}>
    <div className="flex items-start justify-between">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-charcoal transition-colors ${live ? 'border-mineral-teal/40' : alert ? 'border-desert-rose/40' : 'group-hover:border-hairline-strong'}`}>
        {icon}
      </div>
      <span className={`relative flex h-2 w-2 mt-1 ${live || alert ? '' : 'opacity-0'}`}>
        {(live || alert) && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${live ? 'bg-mineral-teal' : 'bg-desert-rose'}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? 'bg-mineral-teal' : 'bg-desert-rose'}`} />
      </span>
    </div>
    <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sand">
      {label}
    </div>
    <div className="mt-1 text-2xl font-semibold tabular-nums text-linen">{value}</div>
    {hint && <div className="mt-1 text-[11px] text-sand opacity-80">{hint}</div>}
    <div className={`pointer-events-none absolute inset-x-0 -bottom-16 h-24 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-[0.12] ${accent}`} />
  </div>
);

const skeletonRows = Array.from({ length: 6 }, (_, index) => index);

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

type RangeFilter = 'ALL' | '24h' | '7d' | '30d';

export const ProcessOperations: React.FC<{
  projectId?: string;
  /** Project OPERATOR or OWNER: may retry incidents (the engine enforces it too). */
  canRetryIncidents?: boolean;
  /** Project operator, maintainer or owner: may roll a process back to an earlier version. */
  canRollBack?: boolean;
  onOpenInstance?: (instance: ProcessInstanceDTO) => void;
  onOpenDetail?: (instance: ProcessInstanceDTO) => void;
  /** Opens an incident's instance focused on its step (M5 S4). */
  onOpenIncident?: (incident: IncidentDTO) => void;
}> = ({ projectId, canRetryIncidents = false, canRollBack = false, onOpenInstance, onOpenDetail, onOpenIncident }) => {
  const [instances, setInstances] = useState<ProcessInstanceDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'ALL' | InstanceStatus>('ALL');
  const [definitionFilter, setDefinitionFilter] = useState<string>('ALL');
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('ALL');
  const [search, setSearch] = useState('');

  const [definitions, setDefinitions] = useState<ProcessDefinitionDTO[]>([]);
  const [kpis, setKpis] = useState<{ active: number; completed24h: number; failed: number; avgLatencyMs: number | null }>({
    active: 0, completed24h: 0, failed: 0, avgLatencyMs: null,
  });
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [variablesFor, setVariablesFor] = useState<ProcessInstanceDTO | null>(null);
  const [variablesData, setVariablesData] = useState<Record<string, unknown> | null>(null);
  const [variablesLoading, setVariablesLoading] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openIncidents, setOpenIncidents] = useState(0);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /** Monotonic request id so a slow, stale response can never overwrite a newer one. */
  const requestSeq = useRef(0);

  /* ---- API calls ---- */

  const fetchPage = useCallback(async (
    project: string | undefined,
    requestedPage: number,
    replace: boolean,
    preferFresh = false,
  ) => {
    const seq = ++requestSeq.current;
    try {
      setError(null);
      if (replace) setLoading(true);
      else setLoadingMore(true);
      const params: { status?: string; processDefinitionId?: string } = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (definitionFilter !== 'ALL') params.processDefinitionId = definitionFilter;
      const result = await EngineAPI.getInstances(project, { ...params, page: requestedPage, size: 50 });
      if (seq !== requestSeq.current) return; // superseded by a newer request
      setPage(result.page);
      setTotal(result.total);
      // Refresh paths want the fresh rows to win over stale copies; the load-more
      // path only appends unseen rows, so previous stays preferred there.
      setInstances((previous) => (replace
        ? result.items
        : preferFresh
          ? mergeUnique(result.items, previous)
          : mergeUnique(previous, result.items)));
    } catch (cause) {
      if (seq === requestSeq.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [statusFilter, definitionFilter]);

  const fetchKpis = useCallback(async (project: string | undefined) => {
    try {
      const [running, failed, completed] = await Promise.all([
        EngineAPI.getInstances(project, { status: 'RUNNING', size: 1 }),
        EngineAPI.getInstances(project, { status: 'FAILED', size: 1 }),
        EngineAPI.getInstances(project, { status: 'COMPLETED', size: 100 }),
      ]);
      const since24h = Date.now() - 24 * 3600 * 1000;
      const completed24h = completed.items.filter(
        (item) => item.endDate && new Date(item.endDate).getTime() >= since24h,
      ).length;
      const durations = completed.items
        .filter((item) => item.endDate && item.startDate)
        .map((item) => new Date(item.endDate as string).getTime() - new Date(item.startDate).getTime())
        .filter((ms) => ms >= 0);
      setKpis({
        active: running.total,
        failed: failed.total,
        completed24h,
        avgLatencyMs: durations.length ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length : null,
      });
    } catch {
      // Keep the last known KPIs; the next auto-refresh tick retries.
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchPage(projectId, 0, true), fetchKpis(projectId)]);
  }, [projectId, fetchPage, fetchKpis]);

  /* ---- Definitions for the filter dropdown ---- */

  useEffect(() => {
    if (!projectId) {
      setDefinitions([]);
      return;
    }
    EngineAPI.getProcessDefinitions(projectId)
      .then((items) => {
        const latestByKey = new Map<string, ProcessDefinitionDTO>();
        for (const item of items) {
          const current = latestByKey.get(item.id);
          if (!current || item.version > current.version) latestByKey.set(item.id, item);
        }
        setDefinitions([...latestByKey.values()].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => setDefinitions([]));
  }, [projectId]);

  /* ---- Initial load + filter-driven reloads ---- */

  useEffect(() => {
    setInstances([]);
    setPage(0);
    setTotal(0);
    void fetchPage(projectId, 0, true);
    void fetchKpis(projectId);
  }, [projectId, fetchPage, fetchKpis]);

  /* ---- Auto refresh (live KPI + first page merge) ---- */

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void fetchKpis(projectId);
      void fetchPage(projectId, 0, false, true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [projectId, autoRefresh, fetchKpis, fetchPage]);

  /* ---- Toast auto dismiss ---- */

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /* ---- Client-side derived view (search + time range) ---- */

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const since =
      rangeFilter === '24h' ? Date.now() - 24 * 3600 * 1000
        : rangeFilter === '7d' ? Date.now() - 7 * 24 * 3600 * 1000
          : rangeFilter === '30d' ? Date.now() - 30 * 24 * 3600 * 1000
            : 0;
    return instances.filter((instance) => {
      if (since && new Date(instance.startDate).getTime() < since) return false;
      if (!query) return true;
      const { label } = deriveBusinessLabel(instance);
      const haystack = [
        label, instance.id, instance.processDefinitionId,
        instance.processDefinitionName ?? '', humanize(instance.currentActivityId ?? ''),
        statusOf(instance),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [instances, search, rangeFilter]);

  const hasMore = instances.length < total;

  /* ---- Infinite scroll ---- */

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          void fetchPage(projectId, page + 1, false);
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [projectId, hasMore, loading, loadingMore, page, fetchPage]);

  /* ---- Instance actions ---- */

  const runMutation = async (action: () => Promise<void>, successMessage: string) => {
    setConfirm(null);
    if (!projectId) return;
    try {
      await action();
      setToast(successMessage);
      void fetchPage(projectId, 0, false, true);
      void fetchKpis(projectId);
    } catch (cause) {
      setToast(`${successMessage} — failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const openVariables = async (instance: ProcessInstanceDTO) => {
    if (!projectId) return;
    setVariablesFor(instance);
    setVariablesData(null);
    setVariablesLoading(true);
    try {
      setVariablesData(await EngineAPI.getInstanceVariables(instance.id, projectId));
    } catch (cause) {
      setVariablesData({ __error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setVariablesLoading(false);
    }
  };

  /* ---- Derived display data ---- */

  const definitionName = (instance: ProcessInstanceDTO): { name: string; version: string } => {
    if (instance.processDefinitionDeploymentId) {
      const exact = definitions.find((item) => item.deploymentId === instance.processDefinitionDeploymentId);
      if (exact) return { name: exact.name || instance.processDefinitionId, version: `v${exact.version}` };
    }
    const fallback = definitions.find((item) => item.id === instance.processDefinitionId);
    if (fallback) return { name: fallback.name || instance.processDefinitionId, version: `v${fallback.version}` };
    return { name: instance.processDefinitionName || cleanKey(instance.processDefinitionId), version: '' };
  };

  const averageLatency = kpis.avgLatencyMs !== null ? formatDuration(kpis.avgLatencyMs) : '—';

  /* ------------------------------------------------------------------ */

  return (
    <TooltipProvider delayDuration={0}>
    <div className="flex h-full w-full flex-col overflow-hidden bg-charcoal text-linen">
      {/* ===== Header ===== */}
      <div className="flex shrink-0 items-center justify-between border-b border-hairline bg-mocha px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-mineral-teal/30 bg-mineral-teal/10 shadow-warm-md">
            <Activity className="h-4 w-4 text-mineral-teal" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-linen">Process Operations</h1>
            <p className="text-[11px] text-sand">
              Live executions of every APL definition in the project — ACID state machines and agent nodes, one surface.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setAutoRefresh((value) => !value)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all ${
              autoRefresh
                ? 'border-mineral-teal/40 bg-mineral-teal/10 text-mineral-teal'
                : 'border-hairline bg-charcoal text-sand hover:text-linen'
            }`}
            title={autoRefresh ? 'Auto-refresh every 15s — click to pause' : 'Auto-refresh paused — click to resume'}
          >
            <span className="relative flex h-1.5 w-1.5">
              {autoRefresh && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mineral-teal opacity-60" />}
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mineral-teal" />
            </span>
            Live
          </button>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={loading && !loadingMore}
            className="flex items-center gap-1.5 rounded-lg border border-hairline bg-charcoal px-2.5 py-1.5 text-[11px] font-semibold text-sand transition-all hover:border-hairline-strong hover:text-linen disabled:opacity-50"
            title="Refresh instances and KPIs"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ===== KPI bar ===== */}
      <div className="grid shrink-0 grid-cols-2 gap-3 px-6 pt-4 lg:grid-cols-4">
        <KpiCard
          icon={<CircleDot className="h-4 w-4 text-mineral-teal" />}
          label="Active Instances"
          value={String(kpis.active)}
          hint="Running tokens right now"
          accent="bg-mineral-teal"
          live
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4 text-sage-green" />}
          label="Completed · 24h"
          value={String(kpis.completed24h)}
          hint="Reached an end event in the last day"
          accent="bg-sage-green"
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4 text-desert-rose" />}
          label="Needs Intervention"
          value={String(kpis.failed + openIncidents)}
          hint={kpis.failed + openIncidents > 0
            ? `${kpis.failed} failed ${kpis.failed === 1 ? 'instance' : 'instances'} · ${openIncidents} open ${openIncidents === 1 ? 'incident' : 'incidents'}`
            : 'No failed executions or open incidents'}
          accent="bg-desert-rose"
          alert={kpis.failed + openIncidents > 0}
        />
        <KpiCard
          icon={<Gauge className="h-4 w-4 text-amethyst" />}
          label="Avg Execution Latency"
          value={averageLatency}
          hint="Across terminal instances"
          accent="bg-amethyst"
        />
      </div>

      {/* ===== Agent worker liveness ===== */}
      <WorkerHealthPanel projectId={projectId} />

      {/* ===== Open incidents ===== */}
      <IncidentsPanel
        projectId={projectId}
        canRetry={canRetryIncidents}
        onCountChange={setOpenIncidents}
        onOpenIncident={onOpenIncident}
        onRetried={(incident) => {
          setToast(`Retried ${humanize(incident.activityId)}`);
          if (projectId) {
            void fetchPage(projectId, 0, false, true);
            void fetchKpis(projectId);
          }
        }}
      />

      {/* ===== Versions and rollback ===== */}
      <VersionsPanel
        projectId={projectId}
        processKeys={[...new Set(definitions.map((definition) => definition.id))].sort()}
        canRollBack={canRollBack}
        onRolledBack={(key, version) => setToast(`Rolled ${cleanKey(key)} back to v${version}`)}
      />

      {/* ===== Filter toolbar ===== */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sand" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by business key, process name, node or instance id…"
            className="w-full rounded-lg border border-hairline bg-charcoal py-2 pl-9 pr-3 text-xs text-linen placeholder-sand outline-none transition-all focus:border-saffron focus:ring-2 focus:ring-saffron/15"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sand hover:text-linen"
              title="Clear search"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-hairline bg-mocha p-1">
          {(['ALL', 'RUNNING', 'COMPLETED', 'SUSPENDED', 'FAILED'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all ${
                statusFilter === status
                  ? status === 'ALL'
                    ? 'bg-amethyst/20 text-amethyst'
                    : 'bg-mocha-hover text-linen border border-hairline'
                  : 'text-sand hover:text-linen hover:bg-mocha-hover border border-transparent'
              }`}
            >
              {status === 'ALL' ? 'All' : STATUS_META[status].label}
            </button>
          ))}
        </div>

        <div className="relative">
          <select
            value={definitionFilter}
            onChange={(event) => setDefinitionFilter(event.target.value)}
            className="appearance-none rounded-lg border border-hairline bg-charcoal py-2 pl-3 pr-8 text-xs text-sand outline-none transition-all hover:text-linen focus:border-amethyst/60"
            title="Filter by process definition"
          >
            <option value="ALL">All definitions</option>
            {definitions.map((definition) => (
              <option key={`${definition.id}-${definition.deploymentId}`} value={definition.id}>
                {definition.name || definition.id} · v{definition.version}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sand" />
        </div>

        <div className="relative">
          <select
            value={rangeFilter}
            onChange={(event) => setRangeFilter(event.target.value as RangeFilter)}
            className="appearance-none rounded-lg border border-hairline bg-charcoal py-2 pl-3 pr-8 text-xs text-sand outline-none transition-all hover:text-linen focus:border-amethyst/60"
            title="Filter by start time"
          >
            <option value="ALL">All time</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sand" />
        </div>
      </div>

      {/* ===== Result summary ===== */}
      <div className="flex shrink-0 items-center justify-between px-6 pb-2 pt-3">
        <span className="text-[11px] text-sand">
          Showing <span className="font-semibold text-linen tabular-nums">{filtered.length}</span> of{' '}
          <span className="font-semibold text-linen tabular-nums">{total}</span> instances
          {statusFilter !== 'ALL' && ` · ${STATUS_META[statusFilter].label.toLowerCase()}`}
        </span>
        {error && (
          <span className="flex items-center gap-1.5 text-[11px] text-desert-rose">
            <AlertTriangle className="h-3 w-3" /> {error}
          </span>
        )}
      </div>

      {/* ===== Table ===== */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <div className="overflow-hidden rounded-xl border border-hairline bg-mocha">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-hairline bg-charcoal/95 backdrop-blur">
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sand">Status</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sand">Instance</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sand">Process</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sand">Current Node</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sand">Duration</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sand">Started</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-sand">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && instances.length === 0
                ? skeletonRows.map((row) => (
                    <tr key={`skeleton-${row}`} className="border-b border-hairline/50">
                      <td className="px-4 py-3.5" colSpan={7}>
                        <div className="animate-shimmer h-6 w-full rounded-md" />
                      </td>
                    </tr>
                  ))
                : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-hairline bg-charcoal">
                          <Terminal className="h-5 w-5 text-sand" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-linen">
                            {instances.length === 0 && !search && rangeFilter === 'ALL'
                              ? 'No process instances found'
                              : 'No instances match these filters'}
                          </p>
                          <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-sand">
                            {instances.length === 0 && !search && rangeFilter === 'ALL'
                              ? 'Trigger a new workflow via the Canvas (Deploy & Start), an APL definition, the CLI or an external worker — it will appear here the moment it starts.'
                              : 'Try widening the time range, clearing the search or switching the status filter.'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void refreshAll()}
                          className="mt-1 flex items-center gap-1.5 rounded-lg border border-amethyst/30 bg-amethyst/10 px-3 py-1.5 text-[11px] font-semibold text-amethyst transition-all hover:bg-amethyst/20"
                        >
                          <RefreshCcw className="h-3 w-3" /> Refresh
                        </button>
                      </div>
                    </td>
                  </tr>
                )
                : filtered.map((instance, index) => {
                  const status = statusOf(instance);
                  const { label, source } = deriveBusinessLabel(instance);
                  const definition = definitionName(instance);
                  const duration = formatDuration(instanceDurationMs(instance));
                  return (
                    <tr
                      key={instance.id}
                      onClick={() => onOpenDetail?.(instance)}
                      className="group animate-rise cursor-pointer border-b border-hairline/50 transition-colors last:border-0 hover:bg-mocha-hover/60"
                      style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
                      title="Open instance detail"
                    >
                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge instance={instance} />
                      </td>

                      {/* Instance identity */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {source ? (
                            <Sparkles className="h-3.5 w-3.5 shrink-0 text-amethyst" />
                          ) : (
                            <Zap className="h-3.5 w-3.5 shrink-0 text-sand" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-linen" title={`business key: ${label}`}>
                              {label}
                            </div>
                            <div className="font-mono text-[10px] text-sand">{instance.id.slice(0, 12)}…</div>
                          </div>
                        </div>
                      </td>

                      {/* Process definition */}
                      <td className="px-4 py-3">
                        <div className="text-linen/90">{definition.name}</div>
                        {definition.version && (
                          <span className="mt-0.5 inline-flex rounded border border-amethyst/30 bg-amethyst/10 px-1.5 py-px text-[10px] font-medium text-amethyst">
                            {definition.version}
                          </span>
                        )}
                      </td>

                      {/* Current node */}
                      <td className="px-4 py-3">
                        {status === 'RUNNING' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sage-green opacity-60" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sage-green" />
                            </span>
                            <span className="text-sand">
                              {instance.currentActivityId ? humanize(instance.currentActivityId) : 'Waiting on token'}
                            </span>
                          </div>
                        ) : status === 'FAILED' ? (
                          <span className="text-desert-rose">
                            {instance.currentActivityId ? humanize(instance.currentActivityId) : 'Failed'}
                          </span>
                        ) : (
                          <span className="text-sand opacity-70">—</span>
                        )}
                      </td>

                      {/* Duration */}
                      <td className="px-4 py-3 font-mono tabular-nums text-sand">{duration}</td>

                      {/* Started */}
                      <td className="px-4 py-3">
                        <div className="text-linen/90">{formatWhen(instance.startDate)}</div>
                        <div className="text-[10px] text-sand">
                          {instance.startedBy ? `by ${instance.startedBy}` : '\u00A0'}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <UITooltip content="View Canvas — jump to the live execution graph">
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); onOpenInstance?.(instance); }}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-charcoal text-sand transition-all hover:border-mineral-teal/50 hover:text-mineral-teal"
                              title="View Canvas"
                            >
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </button>
                          </UITooltip>
                          <UITooltip content="Inspect Variables — read the instance variable map">
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); void openVariables(instance); }}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-charcoal text-sand transition-all hover:border-amethyst/50 hover:text-amethyst"
                              title="Inspect Variables"
                            >
                              <Braces className="h-3.5 w-3.5" />
                            </button>
                          </UITooltip>

                          {status === 'RUNNING' && (
                            <>
                              <UITooltip content="Suspend — pause the instance until resumed">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setConfirm({
                                      title: 'Suspend instance',
                                      message: `Suspend ${deriveBusinessLabel(instance).label}? No tokens advance while suspended.`,
                                      confirmLabel: 'Suspend',
                                      onConfirm: () => void runMutation(
                                        () => EngineAPI.setInstanceSuspension(instance.id, projectId as string, true),
                                        `Suspended ${deriveBusinessLabel(instance).label}`,
                                      ),
                                    });
                                  }}
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-charcoal text-sand opacity-0 transition-all hover:border-saffron/60 hover:text-saffron group-hover:opacity-100"
                                  title="Suspend"
                                >
                                  <PauseCircle className="h-3.5 w-3.5" />
                                </button>
                              </UITooltip>
                              <UITooltip content="Cancel — terminate the instance (audited)">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setConfirm({
                                      title: 'Cancel instance',
                                      message: `Cancel ${deriveBusinessLabel(instance).label}? This is terminal and cannot be undone.`,
                                      confirmLabel: 'Cancel instance',
                                      danger: true,
                                      onConfirm: () => void runMutation(
                                        () => EngineAPI.cancelInstance(instance.id, projectId as string),
                                        `Cancelled ${deriveBusinessLabel(instance).label}`,
                                      ),
                                    });
                                  }}
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-charcoal text-sand opacity-0 transition-all hover:border-desert-rose/60 hover:text-desert-rose group-hover:opacity-100"
                                  title="Cancel"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                </button>
                              </UITooltip>
                            </>
                          )}

                          {status === 'SUSPENDED' && (
                            <UITooltip content="Resume — allow tokens to advance again">
                              <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); void runMutation(
                                  () => EngineAPI.setInstanceSuspension(instance.id, projectId as string, false),
                                  `Resumed ${deriveBusinessLabel(instance).label}`,
                                ); }}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-charcoal text-sand opacity-0 transition-all hover:border-mineral-teal/50 hover:text-mineral-teal group-hover:opacity-100"
                                title="Resume"
                              >
                                <PlayCircle className="h-3.5 w-3.5" />
                              </button>
                            </UITooltip>
                          )}

                          {status === 'RUNNING' && (
                            <UITooltip content="Fail — force an unrecoverable failure (audited)">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setConfirm({
                                    title: 'Force fail instance',
                                    message: `Force ${deriveBusinessLabel(instance).label} into FAILED state? Use only for stuck executions that must not continue.`,
                                    confirmLabel: 'Force fail',
                                    danger: true,
                                    onConfirm: () => void runMutation(
                                      async () => { await EngineAPI.failInstance(instance.id, projectId as string); },
                                      `Failed ${deriveBusinessLabel(instance).label}`,
                                    ),
                                  });
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-charcoal text-sand opacity-0 transition-all hover:border-desert-rose/60 hover:text-desert-rose group-hover:opacity-100"
                                title="Fail"
                              >
                                <AlertTriangle className="h-3.5 w-3.5" />
                              </button>
                            </UITooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>

          {/* Infinite scroll sentinel + load more */}
          <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-3 text-[11px] text-sand">
            {loadingMore ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-mineral-teal" />
                Loading more instances…
              </span>
            ) : hasMore ? (
              <button
                type="button"
                onClick={() => projectId && void fetchPage(projectId, page + 1, false)}
                className="rounded-md px-2 py-1 font-semibold text-sand transition-colors hover:text-mineral-teal"
              >
                Load more ({total - instances.length} remaining)
              </button>
            ) : instances.length > 0 ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-sage-green" /> All instances loaded
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* ===== Variables modal ===== */}
      {variablesFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={() => setVariablesFor(null)}>
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-hairline bg-mocha shadow-warm-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-linen">
                  <Braces className="h-4 w-4 text-amethyst" />
                  Instance Variables
                </h2>
                <p className="mt-0.5 font-mono text-[10px] text-sand">{variablesFor.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setVariablesFor(null)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-sand transition-colors hover:bg-mocha-hover hover:text-linen"
                title="Close"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-[240px] flex-1 overflow-auto bg-charcoal p-4">
              {variablesLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-[11px] text-sand">
                  <Loader2 className="h-4 w-4 animate-spin text-mineral-teal" /> Reading variables…
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-linen/80">
                  {JSON.stringify(unwrapVariable(variablesData ?? {}), null, 2)}
                </pre>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-hairline px-5 py-3 text-[10px] text-sand">
              <span>Typed values, written in-transaction by the engine.</span>
              <button
                type="button"
                onClick={() => setVariablesFor(null)}
                className="rounded-lg border border-hairline px-3 py-1.5 font-semibold text-sand transition-colors hover:border-hairline-strong hover:text-linen"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Confirm dialog ===== */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={() => setConfirm(null)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-hairline bg-mocha p-5 shadow-warm-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg border ${confirm.danger ? 'border-desert-rose/30 bg-desert-rose/10' : 'border-saffron/30 bg-saffron/10'}`}>
              {confirm.danger
                ? <AlertTriangle className="h-4 w-4 text-desert-rose" />
                : <PauseCircle className="h-4 w-4 text-saffron" />}
            </div>
            <h3 className="text-sm font-semibold text-linen">{confirm.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-sand">{confirm.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-semibold text-sand transition-colors hover:border-hairline-strong hover:text-linen"
              >
                Keep running
              </button>
              <button
                type="button"
                onClick={confirm.onConfirm}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-charcoal transition-all active:scale-95 ${
                  confirm.danger ? 'bg-desert-rose hover:bg-desert-rose-bright' : 'bg-saffron hover:bg-saffron-bright'
                }`}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Toast ===== */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 animate-rise">
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-mocha px-4 py-2 text-xs font-medium text-linen shadow-warm-lg">
            <CheckCircle2 className="h-3.5 w-3.5 text-sage-green" />
            {toast}
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
};
