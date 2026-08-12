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
  ProcessDefinitionDTO,
  ProcessInstanceDTO,
} from '@/api/engine';
import { TooltipProvider, UITooltip } from '@/components/ui';
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
  <div className={`group relative overflow-hidden rounded-xl border bg-[#25201D] p-4 transition-all duration-300 hover:-translate-y-0.5 ${
    live ? 'border-[#2A9D8F]/40 shadow-warm-md' : alert ? 'border-[#E76F51]/40 shadow-warm-md' : 'border-[#3A322E] hover:border-[#4A403A]'
  }`}>
    <div className="flex items-start justify-between">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg border border-[#3A322E] bg-[#1A1614] transition-colors ${live ? 'border-[#2A9D8F]/40' : alert ? 'border-[#E76F51]/40' : 'group-hover:border-[#4A403A]'}`}>
        {icon}
      </div>
      <span className={`relative flex h-2 w-2 mt-1 ${live || alert ? '' : 'opacity-0'}`}>
        {(live || alert) && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${live ? 'bg-[#2A9D8F]' : 'bg-[#E76F51]'}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? 'bg-[#2A9D8F]' : 'bg-[#E76F51]'}`} />
      </span>
    </div>
    <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">
      {label}
    </div>
    <div className="mt-1 text-2xl font-semibold tabular-nums text-[#EAE3D9]">{value}</div>
    {hint && <div className="mt-1 text-[11px] text-[#A89F91] opacity-80">{hint}</div>}
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
  onOpenInstance?: (instance: ProcessInstanceDTO) => void;
  onOpenDetail?: (instance: ProcessInstanceDTO) => void;
}> = ({ projectId, onOpenInstance, onOpenDetail }) => {
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

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /** Monotonic request id so a slow, stale response can never overwrite a newer one. */
  const requestSeq = useRef(0);

  /* ---- API calls ---- */

  const fetchPage = useCallback(async (
    project: string,
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

  const fetchKpis = useCallback(async (project: string) => {
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
    if (!projectId) return;
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
    if (!projectId) return;
    setInstances([]);
    setPage(0);
    setTotal(0);
    void fetchPage(projectId, 0, true);
    void fetchKpis(projectId);
  }, [projectId, fetchPage, fetchKpis]);

  /* ---- Auto refresh (live KPI + first page merge) ---- */

  useEffect(() => {
    if (!projectId || !autoRefresh) return;
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
    if (!sentinel || !projectId || !hasMore || loading || loadingMore) return;
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
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#1A1614] text-[#EAE3D9]">
      {/* ===== Header ===== */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#3A322E] bg-[#25201D] px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2A9D8F]/30 bg-[#2A9D8F]/10 shadow-warm-md">
            <Activity className="h-4 w-4 text-[#2A9D8F]" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-[#EAE3D9]">Process Operations</h1>
            <p className="text-[11px] text-[#A89F91]">
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
                ? 'border-[#2A9D8F]/40 bg-[#2A9D8F]/10 text-[#2A9D8F]'
                : 'border-[#3A322E] bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9]'
            }`}
            title={autoRefresh ? 'Auto-refresh every 15s — click to pause' : 'Auto-refresh paused — click to resume'}
          >
            <span className="relative flex h-1.5 w-1.5">
              {autoRefresh && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2A9D8F] opacity-60" />}
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#2A9D8F]" />
            </span>
            Live
          </button>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={loading && !loadingMore}
            className="flex items-center gap-1.5 rounded-lg border border-[#3A322E] bg-[#1A1614] px-2.5 py-1.5 text-[11px] font-semibold text-[#A89F91] transition-all hover:border-[#4A403A] hover:text-[#EAE3D9] disabled:opacity-50"
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
          icon={<CircleDot className="h-4 w-4 text-[#2A9D8F]" />}
          label="Active Instances"
          value={String(kpis.active)}
          hint="Running tokens right now"
          accent="bg-[#2A9D8F]"
          live
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4 text-[#90A955]" />}
          label="Completed · 24h"
          value={String(kpis.completed24h)}
          hint="Reached an end event in the last day"
          accent="bg-[#90A955]"
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4 text-[#E76F51]" />}
          label="Needs Intervention"
          value={String(kpis.failed)}
          hint={kpis.failed > 0 ? 'Failed instances require attention' : 'No failed executions'}
          accent="bg-[#E76F51]"
          alert={kpis.failed > 0}
        />
        <KpiCard
          icon={<Gauge className="h-4 w-4 text-[#9D4EDD]" />}
          label="Avg Execution Latency"
          value={averageLatency}
          hint="Across terminal instances"
          accent="bg-[#9D4EDD]"
        />
      </div>

      {/* ===== Filter toolbar ===== */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A89F91]" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by business key, process name, node or instance id…"
            className="w-full rounded-lg border border-[#3A322E] bg-[#1A1614] py-2 pl-9 pr-3 text-xs text-[#EAE3D9] placeholder-[#A89F91] outline-none transition-all focus:border-[#F4A261] focus:ring-2 focus:ring-[#F4A261]/15"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#A89F91] hover:text-[#EAE3D9]"
              title="Clear search"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[#3A322E] bg-[#25201D] p-1">
          {(['ALL', 'RUNNING', 'COMPLETED', 'SUSPENDED', 'FAILED'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all ${
                statusFilter === status
                  ? status === 'ALL'
                    ? 'bg-[#9D4EDD]/20 text-[#9D4EDD]'
                    : 'bg-[#2F2926] text-[#EAE3D9] border border-[#3A322E]'
                  : 'text-[#A89F91] hover:text-[#EAE3D9] hover:bg-[#2F2926] border border-transparent'
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
            className="appearance-none rounded-lg border border-[#3A322E] bg-[#1A1614] py-2 pl-3 pr-8 text-xs text-[#A89F91] outline-none transition-all hover:text-[#EAE3D9] focus:border-[#9D4EDD]/60"
            title="Filter by process definition"
          >
            <option value="ALL">All definitions</option>
            {definitions.map((definition) => (
              <option key={`${definition.id}-${definition.deploymentId}`} value={definition.id}>
                {definition.name || definition.id} · v{definition.version}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A89F91]" />
        </div>

        <div className="relative">
          <select
            value={rangeFilter}
            onChange={(event) => setRangeFilter(event.target.value as RangeFilter)}
            className="appearance-none rounded-lg border border-[#3A322E] bg-[#1A1614] py-2 pl-3 pr-8 text-xs text-[#A89F91] outline-none transition-all hover:text-[#EAE3D9] focus:border-[#9D4EDD]/60"
            title="Filter by start time"
          >
            <option value="ALL">All time</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A89F91]" />
        </div>
      </div>

      {/* ===== Result summary ===== */}
      <div className="flex shrink-0 items-center justify-between px-6 pb-2 pt-3">
        <span className="text-[11px] text-[#A89F91]">
          Showing <span className="font-semibold text-[#EAE3D9] tabular-nums">{filtered.length}</span> of{' '}
          <span className="font-semibold text-[#EAE3D9] tabular-nums">{total}</span> instances
          {statusFilter !== 'ALL' && ` · ${STATUS_META[statusFilter].label.toLowerCase()}`}
        </span>
        {error && (
          <span className="flex items-center gap-1.5 text-[11px] text-[#E76F51]">
            <AlertTriangle className="h-3 w-3" /> {error}
          </span>
        )}
      </div>

      {/* ===== Table ===== */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <div className="overflow-hidden rounded-xl border border-[#3A322E] bg-[#25201D]">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-[#3A322E] bg-[#1A1614]/95 backdrop-blur">
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">Status</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">Instance</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">Process</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">Current Node</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">Duration</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">Started</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && instances.length === 0
                ? skeletonRows.map((row) => (
                    <tr key={`skeleton-${row}`} className="border-b border-[#3A322E]/50">
                      <td className="px-4 py-3.5" colSpan={7}>
                        <div className="animate-shimmer h-6 w-full rounded-md" />
                      </td>
                    </tr>
                  ))
                : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#3A322E] bg-[#1A1614]">
                          <Terminal className="h-5 w-5 text-[#A89F91]" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[#EAE3D9]">
                            {instances.length === 0 && !search && rangeFilter === 'ALL'
                              ? 'No process instances found'
                              : 'No instances match these filters'}
                          </p>
                          <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-[#A89F91]">
                            {instances.length === 0 && !search && rangeFilter === 'ALL'
                              ? 'Trigger a new workflow via the Canvas (Deploy & Start), an APL definition, the CLI or an external worker — it will appear here the moment it starts.'
                              : 'Try widening the time range, clearing the search or switching the status filter.'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void refreshAll()}
                          className="mt-1 flex items-center gap-1.5 rounded-lg border border-[#9D4EDD]/30 bg-[#9D4EDD]/10 px-3 py-1.5 text-[11px] font-semibold text-[#9D4EDD] transition-all hover:bg-[#9D4EDD]/20"
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
                      className="group animate-rise cursor-pointer border-b border-[#3A322E]/50 transition-colors last:border-0 hover:bg-[#2F2926]/60"
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
                            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#9D4EDD]" />
                          ) : (
                            <Zap className="h-3.5 w-3.5 shrink-0 text-[#A89F91]" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-[#EAE3D9]" title={`business key: ${label}`}>
                              {label}
                            </div>
                            <div className="font-mono text-[10px] text-[#A89F91]">{instance.id.slice(0, 12)}…</div>
                          </div>
                        </div>
                      </td>

                      {/* Process definition */}
                      <td className="px-4 py-3">
                        <div className="text-[#EAE3D9]/90">{definition.name}</div>
                        {definition.version && (
                          <span className="mt-0.5 inline-flex rounded border border-[#9D4EDD]/30 bg-[#9D4EDD]/10 px-1.5 py-px text-[10px] font-medium text-[#9D4EDD]">
                            {definition.version}
                          </span>
                        )}
                      </td>

                      {/* Current node */}
                      <td className="px-4 py-3">
                        {status === 'RUNNING' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#90A955] opacity-60" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#90A955]" />
                            </span>
                            <span className="text-[#A89F91]">
                              {instance.currentActivityId ? humanize(instance.currentActivityId) : 'Waiting on token'}
                            </span>
                          </div>
                        ) : status === 'FAILED' ? (
                          <span className="text-[#E76F51]">
                            {instance.currentActivityId ? humanize(instance.currentActivityId) : 'Failed'}
                          </span>
                        ) : (
                          <span className="text-[#A89F91] opacity-70">—</span>
                        )}
                      </td>

                      {/* Duration */}
                      <td className="px-4 py-3 font-mono tabular-nums text-[#A89F91]">{duration}</td>

                      {/* Started */}
                      <td className="px-4 py-3">
                        <div className="text-[#EAE3D9]/90">{formatWhen(instance.startDate)}</div>
                        <div className="text-[10px] text-[#A89F91]">
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
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-[#3A322E] bg-[#1A1614] text-[#A89F91] transition-all hover:border-[#2A9D8F]/50 hover:text-[#2A9D8F]"
                              title="View Canvas"
                            >
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </button>
                          </UITooltip>
                          <UITooltip content="Inspect Variables — read the instance variable map">
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); void openVariables(instance); }}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-[#3A322E] bg-[#1A1614] text-[#A89F91] transition-all hover:border-[#9D4EDD]/50 hover:text-[#9D4EDD]"
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
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[#3A322E] bg-[#1A1614] text-[#A89F91] opacity-0 transition-all hover:border-[#F4A261]/60 hover:text-[#F4A261] group-hover:opacity-100"
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
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[#3A322E] bg-[#1A1614] text-[#A89F91] opacity-0 transition-all hover:border-[#E76F51]/60 hover:text-[#E76F51] group-hover:opacity-100"
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
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-[#3A322E] bg-[#1A1614] text-[#A89F91] opacity-0 transition-all hover:border-[#2A9D8F]/50 hover:text-[#2A9D8F] group-hover:opacity-100"
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
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-[#3A322E] bg-[#1A1614] text-[#A89F91] opacity-0 transition-all hover:border-[#E76F51]/60 hover:text-[#E76F51] group-hover:opacity-100"
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
          <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-3 text-[11px] text-[#A89F91]">
            {loadingMore ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2A9D8F]" />
                Loading more instances…
              </span>
            ) : hasMore ? (
              <button
                type="button"
                onClick={() => projectId && void fetchPage(projectId, page + 1, false)}
                className="rounded-md px-2 py-1 font-semibold text-[#A89F91] transition-colors hover:text-[#2A9D8F]"
              >
                Load more ({total - instances.length} remaining)
              </button>
            ) : instances.length > 0 ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-[#90A955]" /> All instances loaded
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* ===== Variables modal ===== */}
      {variablesFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={() => setVariablesFor(null)}>
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#3A322E] bg-[#25201D] shadow-warm-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#3A322E] px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-[#EAE3D9]">
                  <Braces className="h-4 w-4 text-[#9D4EDD]" />
                  Instance Variables
                </h2>
                <p className="mt-0.5 font-mono text-[10px] text-[#A89F91]">{variablesFor.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setVariablesFor(null)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[#A89F91] transition-colors hover:bg-[#2F2926] hover:text-[#EAE3D9]"
                title="Close"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-[240px] flex-1 overflow-auto bg-[#1A1614] p-4">
              {variablesLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-[11px] text-[#A89F91]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#2A9D8F]" /> Reading variables…
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#EAE3D9]/80">
                  {JSON.stringify(unwrapVariable(variablesData ?? {}), null, 2)}
                </pre>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-[#3A322E] px-5 py-3 text-[10px] text-[#A89F91]">
              <span>Typed values, written in-transaction by the engine.</span>
              <button
                type="button"
                onClick={() => setVariablesFor(null)}
                className="rounded-lg border border-[#3A322E] px-3 py-1.5 font-semibold text-[#A89F91] transition-colors hover:border-[#4A403A] hover:text-[#EAE3D9]"
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
            className="w-full max-w-sm rounded-2xl border border-[#3A322E] bg-[#25201D] p-5 shadow-warm-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg border ${confirm.danger ? 'border-[#E76F51]/30 bg-[#E76F51]/10' : 'border-[#F4A261]/30 bg-[#F4A261]/10'}`}>
              {confirm.danger
                ? <AlertTriangle className="h-4 w-4 text-[#E76F51]" />
                : <PauseCircle className="h-4 w-4 text-[#F4A261]" />}
            </div>
            <h3 className="text-sm font-semibold text-[#EAE3D9]">{confirm.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[#A89F91]">{confirm.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded-lg border border-[#3A322E] px-3 py-1.5 text-xs font-semibold text-[#A89F91] transition-colors hover:border-[#4A403A] hover:text-[#EAE3D9]"
              >
                Keep running
              </button>
              <button
                type="button"
                onClick={confirm.onConfirm}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-[#1A1614] transition-all active:scale-95 ${
                  confirm.danger ? 'bg-[#E76F51] hover:bg-[#f0896f]' : 'bg-[#F4A261] hover:bg-[#f5ad73]'
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
          <div className="flex items-center gap-2 rounded-full border border-[#3A322E] bg-[#25201D] px-4 py-2 text-xs font-medium text-[#EAE3D9] shadow-warm-lg">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#90A955]" />
            {toast}
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
};
