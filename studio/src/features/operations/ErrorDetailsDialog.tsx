import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2 } from 'lucide-react';
import { EngineAPI, JobError } from '@/api/engine';
import { Dialog } from '@/components/ui';
import { FailureContext, formatErrorReport } from '@/lib/run/errorReport';

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex gap-3 py-1 text-[11px]">
    <span className="w-24 shrink-0 text-[#A89F91]">{label}</span>
    <span className="min-w-0 break-words text-[#EAE3D9]">{children}</span>
  </div>
);

/**
 * Error details of a failed external-task attempt: type, message, attempt
 * context and the full stack trace the worker reported (secrets redacted by
 * the worker). Only the most recent attempt's trace is stored by the engine.
 */
export const ErrorDetailsDialog: React.FC<{
  projectId: string;
  jobId: string;
  context: FailureContext;
  onClose: () => void;
}> = ({ projectId, jobId, context, onClose }) => {
  const [error, setError] = useState<JobError | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    EngineAPI.getJobError(projectId, jobId)
      .then((value) => { if (!cancelled) setError(value); })
      .catch((cause) => { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, jobId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatErrorReport(context, error));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context); the trace stays selectable
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      icon={<AlertTriangle className="h-4 w-4 text-[#E76F51]" />}
      title={context.errorType ?? 'Error details'}
      subtitle={context.activityTitle ? `${context.activityTitle} · job ${jobId.slice(0, 12)}` : `Job ${jobId}`}
      footer={(
        <>
          <button type="button" onClick={() => void copy()} disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-[#3A322E] px-3 py-1.5 text-[11px] text-[#A89F91] hover:bg-[#2F2926] hover:text-[#EAE3D9] disabled:opacity-50">
            {copied ? <Check className="h-3.5 w-3.5 text-[#90A955]" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy details'}
          </button>
          <button type="button" onClick={onClose}
            className="rounded-lg border border-[#2A9D8F]/50 bg-[#2A9D8F]/15 px-3 py-1.5 text-[11px] font-medium text-[#2A9D8F]">
            Close
          </button>
        </>
      )}
    >
      {loading && (
        <div className="flex items-center gap-2 py-4 text-[11px] text-[#A89F91]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading error details...
        </div>
      )}
      {!loading && loadError && (
        <p className="rounded-lg border border-[#E76F51]/30 bg-[#E76F51]/10 p-2.5 text-[11px] text-[#E76F51]">{loadError}</p>
      )}
      {!loading && !loadError && (
        <div className="space-y-4">
          {error?.errorMessage && (
            <p className="rounded-lg border border-[#E76F51]/30 bg-[#E76F51]/10 p-2.5 text-[12px] leading-relaxed text-[#E76F51]">
              {error.errorMessage}
            </p>
          )}
          <div className="rounded-xl border border-[#3A322E] bg-[#1A1614] px-3 py-1.5">
            {context.attempt !== undefined && <Row label="Attempt">{context.attempt}</Row>}
            {(context.provider || context.model) && (
              <Row label="Model"><span className="font-mono">{[context.provider, context.model].filter(Boolean).join(' / ')}</span></Row>
            )}
            {context.workerId && <Row label="Worker"><span className="font-mono">{context.workerId}</span></Row>}
            {error?.status && (
              <Row label="Job status">{error.status}{error.retries !== null ? ` · ${error.retries} retries left` : ''}</Row>
            )}
            {context.occurredAt && <Row label="Time">{new Date(context.occurredAt).toLocaleString()}</Row>}
          </div>
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#A89F91]">Stack trace</span>
              <span className="text-[10px] text-[#5A524A]">Latest attempt only · secrets redacted by the worker</span>
            </div>
            {error?.errorDetails ? (
              <pre className="max-h-[45vh] overflow-auto whitespace-pre rounded-lg border border-[#3A322E] bg-[#14110D] p-3 font-mono text-[10.5px] leading-relaxed text-[#C9BFAF] select-text">
                {error.errorDetails}
              </pre>
            ) : (
              <p className="text-[11px] text-[#A89F91]">The worker did not report a stack trace for this job.</p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
};
