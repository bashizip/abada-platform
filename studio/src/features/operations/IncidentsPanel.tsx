import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCcw, Shuffle, Siren } from 'lucide-react';
import { EngineAPI, IncidentDTO } from '@/api/engine';
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
    <div className="shrink-0 border-b border-[#3A322E] bg-[#25201D]" aria-label="Open incidents">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-6 py-2.5 text-left"
        title={collapsed ? 'Expand incidents panel' : 'Collapse incidents panel'}
      >
        <span className="flex items-center gap-2.5">
          <Siren className={`h-3.5 w-3.5 ${incidents.length > 0 ? 'text-[#E76F51]' : 'text-[#2A9D8F]'}`} />
          <span className="text-[11px] font-semibold tracking-wide text-[#EAE3D9]">INCIDENTS</span>
          {!loading && (
            <span className={`text-[10px] font-semibold ${incidents.length > 0 ? 'text-[#E76F51]' : 'text-[#A89F91]'}`}>
              {incidents.length > 0 ? `${incidents.length} open` : 'none open'}
            </span>
          )}
        </span>
        {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-[#A89F91]" /> : <ChevronDown className="h-3.5 w-3.5 text-[#A89F91]" />}
      </button>

      {!collapsed && (
        <div className="max-h-72 space-y-2 overflow-y-auto px-6 pb-3">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-[#E76F51]/40 bg-[#E76F51]/10 px-3 py-2 text-[11px] text-[#E76F51]">
              <AlertTriangle className="h-3.5 w-3.5" /> Incidents unavailable: {error}
            </div>
          )}
          {!loading && incidents.length === 0 && !error && (
            <div className="rounded-lg border border-[#3A322E] bg-[#1A1614] px-3 py-2 text-[11px] text-[#A89F91]">
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

  const retry = async (override?: { model: string; reason: string }) => {
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
    <div className="rounded-lg border border-[#E76F51]/30 bg-[#1A1614] px-3 py-2" aria-label={`Incident ${incident.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="shrink-0 rounded-full border border-[#E76F51]/50 bg-[#E76F51]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#E76F51]"
          title={INCIDENT_KIND_META[incident.type]?.hint}
        >
          {incidentKindLabel(incident.type)}
        </span>
        <span className="text-[11px] font-semibold text-[#EAE3D9]" title={incident.activityId}>
          {humanize(incident.activityId)}
        </span>
        {model && <span className="rounded-full border border-[#9D4EDD]/30 bg-[#9D4EDD]/10 px-2 py-0.5 font-mono text-[10px] text-[#9D4EDD]">{model}</span>}
        {showInstance && (
          <span className="font-mono text-[10px] text-[#A89F91]" title={incident.processInstanceId}>
            {incident.processInstanceId.slice(0, 8)}
          </span>
        )}
        <span className="text-[10px] text-[#A89F91]">· {formatWhen(incident.createdAt)}</span>
        {canRetry && !choosing && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {canChooseModel && (
              <button
                type="button"
                disabled={busy}
                onClick={() => { setChoosing(true); setChosenModel(options[0]); }}
                className="flex items-center gap-1 rounded-md border border-[#9D4EDD]/40 bg-[#9D4EDD]/10 px-2 py-1 text-[10px] font-semibold text-[#9D4EDD] transition-all hover:bg-[#9D4EDD]/20 disabled:opacity-50"
                title="Rerun this agent step on another allowed model (this task only)"
              >
                <Shuffle className="h-3 w-3" /> Retry on another model
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void retry()}
              className="flex items-center gap-1 rounded-md border border-[#F4A261]/40 bg-[#F4A261]/10 px-2 py-1 text-[10px] font-semibold text-[#F4A261] transition-all hover:bg-[#F4A261]/20 disabled:opacity-50"
              title={INCIDENT_KIND_META[incident.type]?.hint ?? 'Restart the stopped token'}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />} Retry
            </button>
          </span>
        )}
      </div>
      {incident.message && (
        <p className="mt-1 break-words text-[10px] leading-relaxed text-[#E76F51]/90">{incident.message}</p>
      )}

      {choosing && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-[#3A322E] bg-[#25201D] p-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosenModel && reason.trim()) void retry({ model: chosenModel, reason: reason.trim() });
          }}
        >
          <label className="flex flex-col gap-1 text-[10px] text-[#A89F91]" htmlFor={`${formId}-model`}>
            Model
            <select
              id={`${formId}-model`}
              value={chosenModel}
              onChange={(event) => setChosenModel(event.target.value)}
              className="rounded-md border border-[#3A322E] bg-[#1A1614] px-2 py-1 font-mono text-[11px] text-[#EAE3D9] outline-none focus:border-[#9D4EDD]"
            >
              {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[10px] text-[#A89F91]" htmlFor={`${formId}-reason`}>
            Reason (required, audited)
            <input
              id={`${formId}-reason`}
              type="text"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. provider outage on the deployed model"
              className="rounded-md border border-[#3A322E] bg-[#1A1614] px-2 py-1 text-[11px] text-[#EAE3D9] placeholder-[#A89F91] outline-none focus:border-[#9D4EDD]"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !chosenModel || !reason.trim()}
            className="rounded-md bg-[#9D4EDD] px-2.5 py-1 text-[10px] font-semibold text-[#1A1614] transition-all hover:bg-[#b06ee6] disabled:opacity-50"
          >
            Retry on {chosenModel}
          </button>
          <button
            type="button"
            onClick={() => { setChoosing(false); setReason(''); setError(null); }}
            className="rounded-md border border-[#3A322E] px-2.5 py-1 text-[10px] font-semibold text-[#A89F91] hover:text-[#EAE3D9]"
          >
            Cancel
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[#E76F51]">
          <AlertTriangle className="h-3 w-3" /> Retry failed: {error}
        </p>
      )}
    </div>
  );
};
