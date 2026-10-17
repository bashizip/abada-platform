import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCcw, Shuffle, Siren } from 'lucide-react';
import { EngineAPI, IncidentDTO, IncidentRetryRequest } from '@/api/engine';
import { useAplContract } from '@/lib/aplContract';
import { formatWhen, humanize } from '@/lib/run/instanceFormat';
import {
  INCIDENT_KIND_META,
  incidentKindLabel,
  loadAgentStepModel,
  offersModelRetry,
  retryModelOptions,
} from '@/lib/run/incidents';

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
  /** Renders nothing while there is no open incident. */
  hideWhenEmpty?: boolean;
  onCountChange?: (count: number) => void;
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
  hideWhenEmpty = false,
  onCountChange,
  onRetried,
}) => {
  const [incidents, setIncidents] = useState<IncidentDTO[]>([]);
  const [loading, setLoading] = useState(true);
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
    if (!projectId) return;
    setLoading(true);
    void refresh(projectId);
    const timer = window.setInterval(() => { void refresh(projectId); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [projectId, refresh]);

  useEffect(() => { onCountChange?.(incidents.length); }, [incidents.length, onCountChange]);

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
    if (projectId) void refresh(projectId);
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
}> = ({ projectId, incident, showInstance, canRetry, model, onRetried }) => {
  const contract = useAplContract();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [chosenModel, setChosenModel] = useState('');
  const [reason, setReason] = useState('');

  const options = retryModelOptions(contract?.allowedAgentModels ?? [], model ?? null);
  const canChooseModel = canRetry && offersModelRetry(incident, model) && options.length > 0;
  const formId = `incident-${incident.id}`;

  const retry = async (override?: IncidentRetryRequest) => {
    setBusy(true);
    setError(null);
    try {
      await EngineAPI.retryIncident(projectId, incident.id, override);
      onRetried();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-desert-rose/30 bg-charcoal px-3 py-2" aria-label={`Incident ${incident.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="shrink-0 rounded-full border border-desert-rose/50 bg-desert-rose/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-desert-rose"
          title={INCIDENT_KIND_META[incident.type]?.hint}
        >
          {incidentKindLabel(incident.type)}
        </span>
        <span className="text-[11px] font-semibold text-linen" title={incident.activityId}>
          {humanize(incident.activityId)}
        </span>
        {model && <span className="rounded-full border border-amethyst/30 bg-amethyst/10 px-2 py-0.5 font-mono text-[10px] text-amethyst">{model}</span>}
        {showInstance && (
          <span className="font-mono text-[10px] text-sand" title={incident.processInstanceId}>
            {incident.processInstanceId.slice(0, 8)}
          </span>
        )}
        <span className="text-[10px] text-sand">· {formatWhen(incident.createdAt)}</span>
        {canRetry && !choosing && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {canChooseModel && (
              <button
                type="button"
                disabled={busy}
                onClick={() => { setChoosing(true); setChosenModel(options[0]); }}
                className="flex items-center gap-1 rounded-md border border-amethyst/40 bg-amethyst/10 px-2 py-1 text-[10px] font-semibold text-amethyst transition-all hover:bg-amethyst/20 disabled:opacity-50"
                title="Rerun this agent step on another allowed model (this task only)"
              >
                <Shuffle className="h-3 w-3" /> Retry on another model
              </button>
            )}
            {incident.type === 'TOOL_OUTCOME_UNKNOWN' ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void retry({ toolOutcome: 'PERFORMED' })}
                  className="flex items-center gap-1 rounded-md border border-sage-green/40 bg-sage-green/10 px-2 py-1 text-[10px] font-semibold text-sage-green transition-all hover:bg-sage-green/20 disabled:opacity-50"
                  title="The write reached the target system: the agent resumes knowing it is done"
                >
                  It happened
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void retry({ toolOutcome: 'NOT_PERFORMED' })}
                  className="flex items-center gap-1 rounded-md border border-saffron/40 bg-saffron/10 px-2 py-1 text-[10px] font-semibold text-saffron transition-all hover:bg-saffron/20 disabled:opacity-50"
                  title="The write did not reach the target system: the agent resumes and decides again"
                >
                  It did not happen
                </button>
              </>
            ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void retry()}
              className="flex items-center gap-1 rounded-md border border-saffron/40 bg-saffron/10 px-2 py-1 text-[10px] font-semibold text-saffron transition-all hover:bg-saffron/20 disabled:opacity-50"
              title={INCIDENT_KIND_META[incident.type]?.hint ?? 'Restart the stopped token'}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />} Retry
            </button>
            )}
          </span>
        )}
      </div>
      {incident.message && (
        <p className="mt-1 break-words text-[10px] leading-relaxed text-desert-rose/90">{incident.message}</p>
      )}

      {choosing && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-hairline bg-mocha p-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosenModel && reason.trim()) void retry({ model: chosenModel, reason: reason.trim() });
          }}
        >
          <label className="flex flex-col gap-1 text-[10px] text-sand" htmlFor={`${formId}-model`}>
            Model
            <select
              id={`${formId}-model`}
              value={chosenModel}
              onChange={(event) => setChosenModel(event.target.value)}
              className="rounded-md border border-hairline bg-charcoal px-2 py-1 font-mono text-[11px] text-linen outline-none focus:border-amethyst"
            >
              {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[10px] text-sand" htmlFor={`${formId}-reason`}>
            Reason (required, audited)
            <input
              id={`${formId}-reason`}
              type="text"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. provider outage on the deployed model"
              className="rounded-md border border-hairline bg-charcoal px-2 py-1 text-[11px] text-linen placeholder-sand outline-none focus:border-amethyst"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !chosenModel || !reason.trim()}
            className="rounded-md bg-amethyst px-2.5 py-1 text-[10px] font-semibold text-charcoal transition-all hover:bg-amethyst-light disabled:opacity-50"
          >
            Retry on {chosenModel}
          </button>
          <button
            type="button"
            onClick={() => { setChoosing(false); setReason(''); setError(null); }}
            className="rounded-md border border-hairline px-2.5 py-1 text-[10px] font-semibold text-sand hover:text-linen"
          >
            Cancel
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-[10px] text-desert-rose">
          <AlertTriangle className="h-3 w-3" /> Retry failed: {error}
        </p>
      )}
    </div>
  );
};
