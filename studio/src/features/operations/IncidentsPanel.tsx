import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, ChevronDown, ChevronRight, Siren } from 'lucide-react';
import { EngineAPI, IncidentDTO } from '@/api/engine';
import { formatWhen, humanize } from '@/lib/run/instanceFormat';
import { INCIDENT_KIND_META, incidentKindLabel, loadAgentStepModel } from '@/lib/run/incidents';
import { IncidentActions } from './IncidentActions';

const POLL_MS = 15000;

interface IncidentsPanelProps {
  projectId?: string;
  /** Show only this instance's incidents (instance detail view). */
  instanceId?: string;
  /** Project OPERATOR or OWNER; the engine still enforces it. */
  canRetry: boolean;
  /**
   * The current model of an incident's step when the caller already holds
   * the definition (null: not an agent step). Without it the panel loads it.
   */
  modelFor?: (incident: IncidentDTO) => string | null;
  /**
   * The incidents to show, when the caller already loads them (the instance
   * view refreshes them with its event stream). Without it the panel polls.
   */
  incidents?: IncidentDTO[];
  /** Opens the incident's instance focused on its step. */
  onOpenIncident?: (incident: IncidentDTO) => void;
  /** Renders nothing while there is no open incident. */
  hideWhenEmpty?: boolean;
  onCountChange?: (count: number) => void;
  /** The open incidents shown, whenever they change (e.g. to mark them on the diagram). */
  onIncidentsChange?: (incidents: IncidentDTO[]) => void;
  onRetried?: (incident: IncidentDTO) => void;
}

/**
 * Open runtime incidents: tokens stopped by failed work, an exhausted loop or
 * a missing correlation key. Operators retry them here; failed agent work can
 * be retried on another allowed model with an audited reason.
 */
export const IncidentsPanel: React.FC<IncidentsPanelProps> = ({
  projectId,
  instanceId,
  canRetry,
  modelFor,
  incidents: given,
  onOpenIncident,
  hideWhenEmpty = false,
  onCountChange,
  onIncidentsChange,
  onRetried,
}) => {
  const [fetched, setIncidents] = useState<IncidentDTO[]>([]);
  const controlled = given !== undefined;
  const incidents = given ?? fetched;
  const [fetching, setLoading] = useState(true);
  const loading = given ? false : fetching;
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [loadedModels, setLoadedModels] = useState<Record<string, string | null>>({});
  const requested = useRef(new Set<string>());
  const pollRef = useRef(0);

  const refresh = useCallback(async (project: string) => {
    const seq = ++pollRef.current;
    try {
      const all = await EngineAPI.getIncidents(project);
      if (seq !== pollRef.current) return;
      setIncidents(instanceId ? all.filter((incident) => incident.processInstanceId === instanceId) : all);
      setError(null);
    } catch (cause) {
      if (seq !== pollRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (seq === pollRef.current) setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    if (!projectId || controlled) return;
    setLoading(true);
    void refresh(projectId);
    const timer = window.setInterval(() => { void refresh(projectId); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [projectId, refresh, controlled]);

  useEffect(() => { onCountChange?.(incidents.length); }, [incidents.length, onCountChange]);
  useEffect(() => { onIncidentsChange?.(incidents); }, [incidents, onIncidentsChange]);

  /* Failed work an operator could rerun on another model: learn whether its step is an agent step. */
  useEffect(() => {
    if (!projectId || !canRetry || modelFor) return;
    for (const incident of incidents) {
      if (incident.type !== 'WORK_FAILED' || requested.current.has(incident.id)) continue;
      requested.current.add(incident.id);
      loadAgentStepModel(projectId, incident)
        .catch(() => null)
        .then((model) => setLoadedModels((current) => ({ ...current, [incident.id]: model })));
    }
  }, [projectId, canRetry, modelFor, incidents]);

  const modelOf = (incident: IncidentDTO): string | null | undefined =>
    modelFor ? modelFor(incident) : loadedModels[incident.id];

  const retried = (incident: IncidentDTO) => {
    setIncidents((current) => current.filter((item) => item.id !== incident.id));
    onRetried?.(incident);
    if (projectId && !controlled) void refresh(projectId);
  };

  if (!projectId || (hideWhenEmpty && incidents.length === 0 && !error)) return null;

  return (
    <div className="shrink-0 border-b border-hairline bg-mocha" aria-label="Open incidents">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-6 py-2.5 text-left"
        title={collapsed ? 'Expand incidents panel' : 'Collapse incidents panel'}
      >
        <span className="flex items-center gap-2.5">
          <Siren className={`h-3.5 w-3.5 ${incidents.length > 0 ? 'text-desert-rose' : 'text-mineral-teal'}`} />
          <span className="text-[11px] font-semibold tracking-wide text-linen">INCIDENTS</span>
          {!loading && (
            <span className={`text-[10px] font-semibold ${incidents.length > 0 ? 'text-desert-rose' : 'text-sand'}`}>
              {incidents.length > 0 ? `${incidents.length} open` : 'none open'}
            </span>
          )}
        </span>
        {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-sand" /> : <ChevronDown className="h-3.5 w-3.5 text-sand" />}
      </button>

      {!collapsed && (
        <div className="max-h-72 space-y-2 overflow-y-auto px-6 pb-3">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-desert-rose/40 bg-desert-rose/10 px-3 py-2 text-[11px] text-desert-rose">
              <AlertTriangle className="h-3.5 w-3.5" /> Incidents unavailable: {error}
            </div>
          )}
          {!loading && incidents.length === 0 && !error && (
            <div className="rounded-lg border border-hairline bg-charcoal px-3 py-2 text-[11px] text-sand">
              No open incidents. A token that stops on failed work, an exhausted loop or a missing correlation key shows up here.
            </div>
          )}
          {incidents.map((incident) => (
            <IncidentRow
              key={incident.id}
              projectId={projectId}
              incident={incident}
              showInstance={!instanceId}
              canRetry={canRetry}
              model={modelOf(incident)}
              onRetried={() => retried(incident)}
              onOpen={onOpenIncident ? () => onOpenIncident(incident) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const IncidentRow: React.FC<{
  projectId: string;
  incident: IncidentDTO;
  showInstance: boolean;
  canRetry: boolean;
  /** Current model of the step; null when it is not an agent step, undefined while unknown. */
  model: string | null | undefined;
  onRetried: () => void;
  onOpen?: () => void;
}> = ({ projectId, incident, showInstance, canRetry, model, onRetried, onOpen }) => (
  <div
    className={`rounded-lg border border-desert-rose/30 bg-charcoal px-3 py-2 ${onOpen ? 'transition-colors hover:border-desert-rose/60' : ''}`}
    aria-label={`Incident ${incident.id}`}
  >
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="shrink-0 rounded-full border border-desert-rose/50 bg-desert-rose/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-desert-rose"
        title={INCIDENT_KIND_META[incident.type]?.hint}
      >
        {incidentKindLabel(incident.type)}
      </span>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex items-center gap-1 text-[11px] font-semibold text-linen underline-offset-2 hover:underline"
          title="Open the instance on this step"
        >
          {humanize(incident.activityId)} <ArrowUpRight className="h-3 w-3 text-sand" />
        </button>
      ) : (
        <span className="text-[11px] font-semibold text-linen" title={incident.activityId}>
          {humanize(incident.activityId)}
        </span>
      )}
      {model && <span className="rounded-full border border-amethyst/30 bg-amethyst/10 px-2 py-0.5 font-mono text-[10px] text-amethyst">{model}</span>}
      {showInstance && (
        <span className="font-mono text-[10px] text-sand" title={incident.processInstanceId}>
          {incident.processInstanceId.slice(0, 8)}
        </span>
      )}
      <span className="text-[10px] text-sand">· {formatWhen(incident.createdAt)}</span>
      <span className="ml-auto">
        <IncidentActions projectId={projectId} incident={incident} canRetry={canRetry} model={model} onRetried={onRetried} />
      </span>
    </div>
    {incident.message && (
      <p className="mt-1 break-words text-[10px] leading-relaxed text-desert-rose/90">{incident.message}</p>
    )}
  </div>
);
