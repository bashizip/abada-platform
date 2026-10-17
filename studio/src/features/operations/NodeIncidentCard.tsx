import React, { useState } from 'react';
import { m } from 'motion/react';
import { CheckCircle2, FileWarning, Loader2, RefreshCcw, Siren, X, XCircle } from 'lucide-react';
import type { ActivityHistoryDTO, IncidentDTO } from '@/api/engine';
import type { WorkflowNode } from '@/types';
import { enterExit, useMotionVariants } from '@/lib/motion';
import { failureOf, type FailureContext } from '@/lib/run/errorReport';
import { formatWhen } from '@/lib/run/instanceFormat';
import { INCIDENT_KIND_META, failedAttempts, incidentKindLabel } from '@/lib/run/incidents';
import type { RetryPhase } from '@/lib/run/retryPhase';
import { IncidentActions } from './IncidentActions';

export interface FailureDetails {
  jobId: string;
  context: FailureContext;
}

interface NodeIncidentCardProps {
  projectId: string;
  incident: IncidentDTO;
  node: WorkflowNode;
  /** The instance history (real facts): attempts and the last failed job come from it. */
  history: readonly ActivityHistoryDTO[];
  /** Project OPERATOR or OWNER: may retry and cancel; the engine enforces it too. */
  canAct: boolean;
  /** Current model of an agent step; null for any other step. */
  model: string | null;
  onRetried: (incident: IncidentDTO) => void;
  /** Opens the error details dialog (rendered by the view, outside the canvas transform). */
  onViewDetails: (failure: FailureDetails) => void;
  onCancelInstance: () => void;
  onClose: () => void;
}

const SECONDARY = 'flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-all';

/**
 * The card on the failing node (M5 S4): what failed, how many attempts, and
 * the actions the existing incident API offers, where the failure is.
 * Permissions decide which buttons render; the engine still enforces them.
 */
export const NodeIncidentCard: React.FC<NodeIncidentCardProps> = ({
  projectId, incident, node, history, canAct, model, onRetried, onViewDetails, onCancelInstance, onClose,
}) => {
  const variants = useMotionVariants(enterExit);
  const [expanded, setExpanded] = useState(false);
  const attempts = failedAttempts(history, node.id);
  const lastFailed = [...history].reverse()
    .find((event) => event.activityId === node.id && event.eventType === 'EXTERNAL_TASK_FAILED');
  const failure = lastFailed ? failureOf(lastFailed, node.title, []) : null;
  const message = incident.message ?? '';

  return (
    <m.div
      role="dialog"
      aria-label={`Incident on ${node.title}`}
      variants={variants}
      initial="initial"
      animate="enter"
      className="w-[300px] rounded-xl border border-desert-rose/50 bg-mocha p-3 text-left shadow-warm-lg"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start gap-2">
        <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-desert-rose/40 bg-desert-rose/10">
          <Siren className="h-3.5 w-3.5 text-desert-rose" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full border border-desert-rose/50 bg-desert-rose/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-desert-rose"
              title={INCIDENT_KIND_META[incident.type]?.hint}
            >
              {incidentKindLabel(incident.type)}
            </span>
            {model && (
              <span className="rounded-full border border-amethyst/30 bg-amethyst/10 px-2 py-0.5 font-mono text-[10px] text-amethyst">{model}</span>
            )}
          </div>
          <div className="mt-1 truncate text-xs font-semibold text-linen">{node.title}</div>
          <div className="text-[10px] text-sand">
            {attempts > 0 && <>{attempts} failed attempt{attempts > 1 ? 's' : ''} · </>}
            {formatWhen(incident.createdAt)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 rounded-md p-1 text-sand transition-colors hover:text-linen"
          aria-label="Close the incident card"
          title="Close (the node keeps its incident badge; click it to reopen)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {message && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={`mt-2 block w-full break-words text-left text-[10px] leading-relaxed text-desert-rose/90 ${expanded ? '' : 'line-clamp-2'}`}
          title={expanded ? 'Show less' : 'Show the whole message'}
        >
          {message}
        </button>
      )}

      {INCIDENT_KIND_META[incident.type]?.hint && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-sand">{INCIDENT_KIND_META[incident.type].hint}</p>
      )}

      <div className="mt-2.5">
        <IncidentActions
          projectId={projectId}
          incident={incident}
          canRetry={canAct}
          model={model}
          onRetried={() => onRetried(incident)}
        >
          {failure && (
            <button
              type="button"
              onClick={() => onViewDetails(failure)}
              className={`${SECONDARY} border-hairline bg-charcoal text-sand hover:border-hairline-strong hover:text-linen`}
              title="Show the error message and full stack trace"
            >
              <FileWarning className="h-3 w-3" /> View details
            </button>
          )}
          {canAct && (
            <button
              type="button"
              onClick={onCancelInstance}
              className={`${SECONDARY} border-desert-rose/40 bg-desert-rose/10 text-desert-rose hover:bg-desert-rose/20`}
              title="Terminate the instance (audited)"
            >
              <XCircle className="h-3 w-3" /> Cancel instance
            </button>
          )}
        </IncidentActions>
      </div>
      {!canAct && (
        <p className="mt-2 text-[10px] text-sand">A project operator or owner can retry this step or cancel the instance.</p>
      )}
    </m.div>
  );
};

const PHASE_TEXT: Record<RetryPhase, string> = {
  retrying: 'Retrying — the work is reopened',
  active: 'Running again',
  completed: 'Completed',
  failed: 'Failed again',
};

/** What the card becomes while a retry plays out on the node. */
export const RetryProgress: React.FC<{ node: WorkflowNode; phase: RetryPhase | undefined }> = ({ node, phase }) => {
  const variants = useMotionVariants(enterExit);
  const shown = phase ?? 'retrying';
  const Icon = shown === 'completed' ? CheckCircle2 : shown === 'failed' ? XCircle : shown === 'active' ? Loader2 : RefreshCcw;
  const tone = shown === 'completed' ? 'text-sage-green border-sage-green/40'
    : shown === 'failed' ? 'text-desert-rose border-desert-rose/40'
      : shown === 'active' ? 'text-amethyst border-amethyst/40' : 'text-saffron border-saffron/40';
  return (
    <m.div
      variants={variants}
      initial="initial"
      animate="enter"
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 rounded-full border bg-mocha px-3 py-1.5 text-[11px] font-semibold shadow-warm-lg ${tone}`}
    >
      <Icon className={`h-3.5 w-3.5 ${shown === 'retrying' || shown === 'active' ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
      <span className="text-linen">{node.title}</span>
      <span>· {PHASE_TEXT[shown]}</span>
    </m.div>
  );
};
