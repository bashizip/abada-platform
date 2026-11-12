import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ClipboardList, Copy, Download, RefreshCw, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import {
  AdminAuditAPI,
  type AdminAuditCatalog,
  type AdminAuditEvent,
  type AdminAuditFilter,
} from '@/api/admin';
import { JsonViewer } from '@/components/json/JsonViewer';
import { EmptyState, IconButton, TooltipProvider } from '@/components/ui';
import { listItem, slideFrom, useMotionVariants } from '@/lib/motion';
import { AUDIT_POLL_MS, actionLabel, dayBound } from '@/lib/adminAudit';

const PAGE_SIZE = 50;

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

interface FilterState {
  actor: string;
  action: string;
  outcome: '' | 'SUCCESS' | 'DENIED';
  projectId: string;
  targetId: string;
  fromDay: string;
  toDay: string;
}

const EMPTY_FILTER: FilterState = { actor: '', action: '', outcome: '', projectId: '', targetId: '', fromDay: '', toDay: '' };

function toApiFilter(state: FilterState): AdminAuditFilter {
  return {
    actor: state.actor, action: state.action, outcome: state.outcome, projectId: state.projectId,
    targetId: state.targetId, from: dayBound(state.fromDay, false), to: dayBound(state.toDay, true),
  };
}

const OutcomeBadge: React.FC<{ outcome: AdminAuditEvent['outcome'] }> = ({ outcome }) => (
  outcome === 'DENIED' ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-desert-rose/40 bg-desert-rose/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-desert-rose">
      <ShieldAlert className="h-3 w-3" aria-hidden="true" /> Denied
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-mineral-teal/40 bg-mineral-teal/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-mineral-teal-bright">
      <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Success
    </span>
  )
);

const inputClass = 'h-8 rounded-lg border border-hairline bg-charcoal px-2.5 text-xs text-linen placeholder:text-sand-dim focus:border-amethyst focus:outline-none';

/**
 * Administration audit trail (S10): who changed what, newest first, with refused
 * attempts. Filters apply on the server; new events slide in at the top while the
 * first page is shown; a row opens its before/after details.
 */
export const AdminAuditTrail: React.FC<{ pollMs?: number }> = ({ pollMs = AUDIT_POLL_MS }) => {
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTER);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTER);
  const [catalog, setCatalog] = useState<AdminAuditCatalog | null>(null);
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminAuditEvent | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const rowVariants = useMotionVariants(listItem);
  const drawerVariants = useMotionVariants(slideFrom('right'));
  const filter = useMemo(() => toApiFilter(applied), [applied]);
  const newest = useRef<number | null>(null);

  useEffect(() => {
    AdminAuditAPI.catalog().then(setCatalog).catch(() => setCatalog(null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await AdminAuditAPI.list(filter, { limit: PAGE_SIZE });
      setEvents(page.items);
      setNextCursor(page.nextCursor);
      setFresh(new Set());
      newest.current = page.items[0]?.id ?? null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The audit trail could not be loaded');
      setEvents([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  // Live updates: ask for events newer than the newest shown, unless the range ends in the past.
  useEffect(() => {
    if (pollMs <= 0 || applied.toDay) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden' || loading) return;
      const after = newest.current ?? 0;
      AdminAuditAPI.list(filter, { after, limit: PAGE_SIZE }).then((page) => {
        if (page.items.length === 0) return;
        newest.current = Math.max(after, page.items[0].id);
        setEvents((current) => {
          const known = new Set(current.map((event) => event.id));
          return [...page.items.filter((event) => !known.has(event.id)), ...current];
        });
        setFresh(new Set(page.items.map((event) => event.id)));
      }).catch(() => { /* the next tick retries */ });
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [filter, pollMs, applied.toDay, loading]);

  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const loadOlder = async () => {
    if (nextCursor == null) return;
    setLoadingOlder(true);
    try {
      const page = await AdminAuditAPI.list(filter, { cursor: nextCursor, limit: PAGE_SIZE });
      setEvents((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Older events could not be loaded');
    } finally {
      setLoadingOlder(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await AdminAuditAPI.exportCsv(filter);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'abada-admin-audit.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The export failed');
    } finally {
      setExporting(false);
    }
  };

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setApplied(draft);
  };

  const clear = () => {
    setDraft(EMPTY_FILTER);
    setApplied(EMPTY_FILTER);
  };

  const copyTrace = async (traceId: string) => {
    try {
      await navigator.clipboard.writeText(traceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const filtered = Object.values(applied).some((value) => value !== '');

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-amethyst/30 bg-amethyst/10">
            <ClipboardList className="h-4 w-4 text-amethyst" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-linen">Audit trail</h3>
            <p className="text-xs text-sand">Every administrative change and refused attempt, recorded with the change itself. It cannot be edited.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <IconButton icon={<RefreshCw className="h-4 w-4" />} label="Refresh" tooltip="Reload the newest events"
            onClick={() => { void load(); }} />
          <IconButton icon={<Download className="h-4 w-4" />} label="Export CSV" disabled={exporting}
            tooltip="Download the filtered events as CSV (up to 10,000)" onClick={() => { void exportCsv(); }} />
        </div>
      </div>

      <form onSubmit={apply} className="flex flex-wrap items-end gap-2 rounded-xl border border-hairline bg-mocha/60 p-3" aria-label="Audit filters">
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-sand">
          Actor
          <input className={inputClass} aria-label="Actor" value={draft.actor} placeholder="username"
            onChange={(event) => setDraft({ ...draft, actor: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-sand">
          Action
          <select className={inputClass} aria-label="Action" value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value })}>
            <option value="">All actions</option>
            {(catalog?.actions ?? []).map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-sand">
          Outcome
          <select className={inputClass} aria-label="Outcome" value={draft.outcome}
            onChange={(event) => setDraft({ ...draft, outcome: event.target.value as FilterState['outcome'] })}>
            <option value="">Any</option>
            <option value="SUCCESS">Success</option>
            <option value="DENIED">Denied</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-sand">
          Target
          <input className={inputClass} aria-label="Target" value={draft.targetId} placeholder="id or key"
            onChange={(event) => setDraft({ ...draft, targetId: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-sand">
          Project
          <input className={inputClass} aria-label="Project" value={draft.projectId} placeholder="project id"
            onChange={(event) => setDraft({ ...draft, projectId: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-sand">
          From
          <input type="date" className={inputClass} aria-label="From" value={draft.fromDay}
            onChange={(event) => setDraft({ ...draft, fromDay: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-sand">
          To
          <input type="date" className={inputClass} aria-label="To" value={draft.toDay}
            onChange={(event) => setDraft({ ...draft, toDay: event.target.value })} />
        </label>
        <button type="submit" className="h-8 rounded-lg bg-amethyst px-3 text-xs font-semibold text-linen hover:bg-amethyst-light">Apply</button>
        {filtered && (
          <button type="button" onClick={clear} className="h-8 rounded-lg border border-hairline px-3 text-xs text-sand hover:text-linen">Clear</button>
        )}
      </form>

      {error && (
        <p role="alert" className="rounded-lg border border-desert-rose/40 bg-desert-rose/10 px-3 py-2 text-xs text-desert-rose-bright">{error}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-hairline bg-mocha/50">
        {loading ? (
          <p className="p-6 text-center text-xs text-sand">Loading the audit trail…</p>
        ) : events.length === 0 ? (
          <EmptyState icon={<ClipboardList className="h-5 w-5" />}
            title={filtered ? 'No event matches these filters' : 'No administrative action recorded yet'}
            description={filtered ? 'Widen the dates or clear a filter.'
              : 'Creating a project, changing a member, saving an AI provider or deploying a process appears here.'} />
        ) : (
          <table className="w-full table-fixed text-left text-xs" aria-label="Administration audit events">
            <thead className="border-b border-hairline bg-mocha-deep text-[10px] uppercase tracking-wider text-sand">
              <tr>
                <th scope="col" className="w-44 px-3 py-2 font-semibold">Time</th>
                <th scope="col" className="w-32 px-3 py-2 font-semibold">Actor</th>
                <th scope="col" className="w-48 px-3 py-2 font-semibold">Action</th>
                <th scope="col" className="px-3 py-2 font-semibold">Target</th>
                <th scope="col" className="w-28 px-3 py-2 font-semibold">Outcome</th>
              </tr>
            </thead>
            <tbody aria-live="polite">
              <AnimatePresence initial={false}>
                {events.map((event) => (
                  <m.tr key={event.id} variants={rowVariants} initial="initial" animate="enter" exit="exit"
                    data-event-id={event.id}
                    tabIndex={0}
                    aria-selected={selected?.id === event.id}
                    onClick={() => setSelected(event)}
                    onKeyDown={(keyEvent) => { if (keyEvent.key === 'Enter' || keyEvent.key === ' ') { keyEvent.preventDefault(); setSelected(event); } }}
                    className={`cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-mocha-hover focus:bg-mocha-hover focus:outline-none ${
                      selected?.id === event.id ? 'bg-mocha-hover' : ''} ${fresh.has(event.id) ? 'bg-amethyst/10' : ''}`}>
                    <td className="truncate px-3 py-2 font-mono text-[11px] text-linen-muted">{formatTime(event.occurredAt)}</td>
                    <td className="truncate px-3 py-2 text-linen">{event.actor}</td>
                    <td className="truncate px-3 py-2 text-linen">{actionLabel(event.action)}</td>
                    <td className="truncate px-3 py-2 text-sand">
                      <span className="text-sand-dim">{event.targetType}</span>{event.targetId ? ` · ${event.targetId}` : ''}
                    </td>
                    <td className="px-3 py-2"><OutcomeBadge outcome={event.outcome} /></td>
                  </m.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </div>

      {nextCursor != null && !loading && (
        <div className="flex justify-center">
          <button type="button" onClick={() => { void loadOlder(); }} disabled={loadingOlder}
            className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-sand hover:text-linen disabled:opacity-50">
            {loadingOlder ? 'Loading…' : 'Load older events'}
          </button>
        </div>
      )}

      <AnimatePresence>
        {selected && (
          <m.aside key={selected.id} variants={drawerVariants} initial="initial" animate="enter" exit="exit"
            role="dialog" aria-label="Audit event details"
            className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-hairline bg-charcoal shadow-warm-md">
            <div className="flex items-start justify-between gap-3 border-b border-hairline p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-linen">{actionLabel(selected.action)}</p>
                <p className="mt-0.5 text-[11px] text-sand">{formatTime(selected.occurredAt)}</p>
              </div>
              <IconButton icon={<X className="h-4 w-4" />} label="Close details" tooltip="Close (Esc)" onClick={() => setSelected(null)} />
            </div>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 p-4 text-xs">
              <dt className="text-sand">Outcome</dt><dd><OutcomeBadge outcome={selected.outcome} /></dd>
              <dt className="text-sand">Actor</dt><dd className="text-linen">{selected.actor}</dd>
              <dt className="text-sand">Roles</dt>
              <dd className="break-words text-linen-muted">{selected.actorRoles.length ? selected.actorRoles.join(', ') : '—'}</dd>
              <dt className="text-sand">Target</dt>
              <dd className="break-words text-linen">{selected.targetType}{selected.targetId ? ` · ${selected.targetId}` : ''}</dd>
              <dt className="text-sand">Project</dt><dd className="break-words text-linen-muted">{selected.projectId ?? '—'}</dd>
              <dt className="text-sand">Client</dt><dd className="font-mono text-linen-muted">{selected.clientIp ?? '—'}</dd>
              <dt className="text-sand">Trace</dt>
              <dd className="flex items-center gap-2 font-mono text-linen-muted">
                {selected.traceId ? (
                  <>
                    <span className="truncate">{selected.traceId}</span>
                    <button type="button" aria-label="Copy trace ID" onClick={() => { void copyTrace(selected.traceId as string); }}
                      className="text-sand hover:text-linen"><Copy className="h-3.5 w-3.5" /></button>
                    {copied && <span className="text-[10px] text-mineral-teal-bright">Copied</span>}
                  </>
                ) : '—'}
              </dd>
            </dl>
            <div className="min-h-0 flex-1 border-t border-hairline p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-sand">What changed</p>
              {selected.details && Object.keys(selected.details).length > 0 ? (
                <JsonViewer data={selected.details} label="details" compact defaultDepth={2} height={320} />
              ) : (
                <p className="text-xs text-sand">No details recorded for this action.</p>
              )}
            </div>
          </m.aside>
        )}
      </AnimatePresence>
    </div>
    </TooltipProvider>
  );
};
