import React, { useMemo, useState } from 'react';
import { AlertOctagon, CheckCircle2, CircleDashed, TriangleAlert } from 'lucide-react';
import type { IncidentDTO, WorkerHealthDTO } from '@/api/engine';
import { Skeleton } from '@/components/ui';
import { humanize } from '@/lib/run/instanceFormat';
import { incidentKindLabel } from '@/lib/run/incidents';
import { IncidentSeverity, SEVERITY_LABEL, bySeverity, incidentSeverity } from '@/lib/run/incidentSeverity';

const SHOWN_INCIDENTS = 3;
const SHOWN_WORKERS = 4;

const timeAgo = (iso: string | null | undefined, now = Date.now()): string => {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};

const SEVERITY_STYLE: Record<IncidentSeverity, { text: string; icon: React.ElementType }> = {
  decision: { text: 'text-desert-rose', icon: AlertOctagon },
  blocked: { text: 'text-saffron', icon: TriangleAlert },
  waiting: { text: 'text-sand', icon: CircleDashed },
};

const IncidentCard: React.FC<{ incident: IncidentDTO; processName: string | null; onOpen?: () => void }> = ({
  incident, processName, onOpen,
}) => {
  const severity = incidentSeverity(incident.type);
  const style = SEVERITY_STYLE[severity];
  return (
    <button type="button" onClick={onOpen} title="Open the instance on the failing step"
      className="flex min-w-0 flex-col gap-1.5 rounded-card border border-hairline bg-mocha-deep px-3 py-2.5 text-left transition-colors hover:border-hairline-strong hover:bg-mocha">
      <span className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${style.text}`}>
        <style.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{SEVERITY_LABEL[severity]} · {incidentKindLabel(incident.type)}</span>
      </span>
      <span className="truncate text-[12.5px] font-semibold text-linen">
        {humanize(incident.activityId)}
        {processName && <span className="font-normal text-sand"> in {processName}</span>}
      </span>
      {incident.message && <span className="line-clamp-2 text-[11.5px] text-sand">{incident.message}</span>}
      <span className="mt-auto flex gap-2 text-[10.5px] text-sand">
        <span className="font-mono">{incident.processInstanceId.slice(0, 8)}</span>
        <span>{timeAgo(incident.createdAt)}</span>
      </span>
    </button>
  );
};

const WORKER_STATE = {
  ONLINE: { label: 'Online', text: 'text-sage-green', dot: 'bg-sage-green abada-live-outline' },
  ERROR: { label: 'Failing', text: 'text-desert-rose', dot: 'bg-desert-rose' },
  OFFLINE: { label: 'Offline', text: 'text-sand', dot: 'bg-stone' },
} as const;
const WORKER_ORDER = { ERROR: 0, OFFLINE: 1, ONLINE: 2 } as const;

const WorkerCard: React.FC<{ worker: WorkerHealthDTO }> = ({ worker }) => {
  const state = WORKER_STATE[worker.status];
  const detail = worker.status === 'ERROR'
    ? `${worker.consecutiveFailures} failure${worker.consecutiveFailures === 1 ? '' : 's'} in a row`
    : worker.status === 'OFFLINE' ? `last seen ${timeAgo(worker.lastSeenAt)}` : `seen ${timeAgo(worker.lastSeenAt)}`;
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-card border border-hairline bg-mocha-deep px-3 py-2.5"
      title={worker.lastErrorMessage ?? undefined}>
      <span className={`flex w-16 shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${state.text}`}>
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />{state.label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[11.5px] text-linen">{worker.topic}</div>
        <div className="truncate text-[10.5px] text-sand">
          {detail}{worker.status === 'ERROR' && worker.lastErrorMessage ? ` · ${worker.lastErrorMessage}` : ''}
        </div>
      </div>
    </div>
  );
};

const Calm: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="col-span-full flex items-center gap-2.5 rounded-card border border-dashed border-hairline px-3.5 py-3 text-xs text-sand">
    {children}
  </div>
);

/**
 * What needs a person now: the most severe open incidents and the health of
 * the workers. Compact cards, most severe first; the full lists open on demand.
 */
export const AttentionBand: React.FC<{
  incidents: IncidentDTO[];
  incidentsLoading: boolean;
  workers: WorkerHealthDTO[];
  workersLoading: boolean;
  /** The process of an instance, when it is among the loaded rows. */
  processName: (processInstanceId: string) => string | null;
  onOpenIncident?: (incident: IncidentDTO) => void;
  onShowAllIncidents: () => void;
}> = ({ incidents, incidentsLoading, workers, workersLoading, processName, onOpenIncident, onShowAllIncidents }) => {
  const [allWorkers, setAllWorkers] = useState(false);
  const sortedIncidents = useMemo(() => bySeverity(incidents), [incidents]);
  const sortedWorkers = useMemo(
    () => [...workers].sort((a, b) => WORKER_ORDER[a.status] - WORKER_ORDER[b.status] || a.topic.localeCompare(b.topic)),
    [workers],
  );
  const online = workers.filter((worker) => worker.status === 'ONLINE').length;
  const shownWorkers = allWorkers ? sortedWorkers : sortedWorkers.slice(0, SHOWN_WORKERS);
  const heading = 'mb-2 flex items-baseline gap-2 text-xs font-semibold text-linen-muted';
  const more = 'ml-auto text-[11px] font-medium text-sand transition-colors hover:text-linen';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section aria-label="Needs attention">
        <h2 className={heading}>
          Needs attention
          {incidents.length > 0 && <span className="font-medium text-sand">{incidents.length} open</span>}
          {incidents.length > 0 && <button type="button" onClick={onShowAllIncidents} className={more}>All incidents →</button>}
        </h2>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {incidentsLoading && incidents.length === 0
            ? [0, 1, 2].map((key) => <Skeleton key={key} className="h-[86px] w-full rounded-card" />)
            : sortedIncidents.length === 0
              ? <Calm><CheckCircle2 className="h-4 w-4 text-sage-green" aria-hidden="true" />Nothing needs attention. Incidents appear here when a step cannot continue on its own.</Calm>
              : sortedIncidents.slice(0, SHOWN_INCIDENTS).map((incident) => (
                <IncidentCard key={incident.id} incident={incident}
                  processName={processName(incident.processInstanceId)}
                  onOpen={onOpenIncident ? () => onOpenIncident(incident) : undefined} />
              ))}
        </div>
      </section>
      <section aria-label="Workers">
        <h2 className={heading}>
          Workers
          {workers.length > 0 && <span className="font-medium text-sand">{online} of {workers.length} online</span>}
          {workers.length > SHOWN_WORKERS && (
            <button type="button" onClick={() => setAllWorkers((value) => !value)} className={more}>
              {allWorkers ? 'Show fewer' : `+${workers.length - SHOWN_WORKERS} more`}
            </button>
          )}
        </h2>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {workersLoading && workers.length === 0
            ? [0, 1].map((key) => <Skeleton key={key} className="h-[50px] w-full rounded-card" />)
            : workers.length === 0
              ? <Calm>No worker has connected to this project yet.</Calm>
              : shownWorkers.map((worker) => <WorkerCard key={`${worker.principalId}-${worker.topic}`} worker={worker} />)}
        </div>
      </section>
    </div>
  );
};
