import React, { useState } from 'react';
import { AlertTriangle, Loader2, RefreshCcw, Shuffle } from 'lucide-react';
import { EngineAPI, IncidentDTO, IncidentRetryRequest } from '@/api/engine';
import { useAplContract } from '@/lib/aplContract';
import { INCIDENT_KIND_META, offersModelRetry, retryModelOptions } from '@/lib/run/incidents';

interface IncidentActionsProps {
  projectId: string;
  incident: IncidentDTO;
  /** Project OPERATOR or OWNER; the engine still enforces it. */
  canRetry: boolean;
  /** Current model of the step; null when it is not an agent step, undefined while unknown. */
  model: string | null | undefined;
  /** The retry was accepted by the engine. */
  onRetried: () => void;
  /** Buttons shown after the retry actions, whoever the viewer is (details, cancel…). */
  children?: React.ReactNode;
}

const ACTION = 'flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-all disabled:opacity-50';

/**
 * The actions on an open incident, shared by the incidents list and the card
 * on the failing node (M5 S4): Retry, Retry on another model (failed agent
 * work), and for an interrupted write the operator's confirmation of whether
 * it happened. Each calls the existing incident retry command.
 */
export const IncidentActions: React.FC<IncidentActionsProps> = ({ projectId, incident, canRetry, model, onRetried, children }) => {
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

  const retryButtons = canRetry && !choosing && (
    <>
      {canChooseModel && (
        <button
          type="button"
          disabled={busy}
          onClick={(event) => { event.stopPropagation(); setChoosing(true); setChosenModel(options[0]); }}
          className={`${ACTION} border-amethyst/40 bg-amethyst/10 text-amethyst hover:bg-amethyst/20`}
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
            onClick={(event) => { event.stopPropagation(); void retry({ toolOutcome: 'PERFORMED' }); }}
            className={`${ACTION} border-sage-green/40 bg-sage-green/10 text-sage-green hover:bg-sage-green/20`}
            title="The write reached the target system: the agent resumes knowing it is done"
          >
            It happened
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={(event) => { event.stopPropagation(); void retry({ toolOutcome: 'NOT_PERFORMED' }); }}
            className={`${ACTION} border-saffron/40 bg-saffron/10 text-saffron hover:bg-saffron/20`}
            title="The write did not reach the target system: the agent resumes and decides again"
          >
            It did not happen
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={(event) => { event.stopPropagation(); void retry(); }}
          className={`${ACTION} border-saffron/40 bg-saffron/10 text-saffron hover:bg-saffron/20`}
          title={INCIDENT_KIND_META[incident.type]?.hint ?? 'Restart the stopped token'}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />} Retry
        </button>
      )}
    </>
  );

  return (
    <>
      {(retryButtons || children) && (
        <span className="flex flex-wrap items-center gap-1.5">
          {retryButtons}
          {children}
        </span>
      )}

      {choosing && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-hairline bg-mocha p-2"
          onClick={(event) => event.stopPropagation()}
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
    </>
  );
};
