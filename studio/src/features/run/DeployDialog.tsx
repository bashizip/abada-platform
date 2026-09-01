import React, { useEffect, useState } from 'react';
import { AlertTriangle, Braces, Lightbulb, Rocket, RotateCcw, X } from 'lucide-react';
import { WorkflowFile } from '@/types';

interface DeployDialogProps {
  workflow: WorkflowFile;
  isOpen: boolean;
  isDeploying: boolean;
  dryRunPassed: boolean;
  defaultPayload: Record<string, unknown>;
  onClose: () => void;
  onConfirm: (payload: Record<string, unknown>) => Promise<void>;
  examples?: Record<string, Record<string, unknown>>;
  onGenerateInsightEvidence?: () => Promise<void>;
  insightEvidenceRunning?: boolean;
}

export const DeployDialog: React.FC<DeployDialogProps> = ({
  workflow, isOpen, isDeploying, dryRunPassed, defaultPayload, onClose, onConfirm,
  examples, onGenerateInsightEvidence, insightEvidenceRunning = false,
}) => {
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(defaultPayload, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPayloadText(JSON.stringify(defaultPayload, null, 2));
    setError(null);
  }, [defaultPayload, isOpen, workflow.id]);

  if (!isOpen) return null;

  const confirm = async () => {
    try {
      const parsed = JSON.parse(payloadText || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Payload must be a JSON object');
      setError(null);
      await onConfirm(parsed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#141110]/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#3A322E] bg-[#25201D] shadow-warm-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#3A322E] bg-[#1A1614]">
          <Rocket className="w-4 h-4 text-[#2A9D8F]" />
          <div><h2 className="text-sm font-semibold">Deploy & Start</h2><p className="text-[10px] text-[#A89F91]">{workflow.name}</p></div>
          <button onClick={onClose} disabled={isDeploying} aria-label="Close deployment" className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {!dryRunPassed && (
            <div className="rounded-xl border border-[#F4A261]/40 bg-[#F4A261]/10 p-3 text-[11px] text-[#F4A261] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>This exact workflow revision has not completed a Dry Run. You can deploy anyway after reviewing the live payload.</span>
            </div>
          )}
          <div className="rounded-xl border border-[#3A322E] bg-[#1A1614] overflow-hidden">
            <div className="px-3 py-2 border-b border-[#3A322E] text-[10px] font-semibold text-[#2A9D8F] flex items-center gap-1"><Braces className="w-3 h-3" /> LIVE INPUT PAYLOAD</div>
            <textarea aria-label="Live deployment input payload" value={payloadText} disabled={isDeploying}
              onChange={(event) => { setPayloadText(event.target.value); setError(null); }}
              className="w-full h-48 p-3 bg-transparent resize-none outline-none font-mono text-[11px] disabled:opacity-60" />
          </div>
          {examples && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#A89F91]">Example:</span>
              {Object.entries(examples).map(([name, payload]) => (
                <button key={name} type="button" disabled={isDeploying || insightEvidenceRunning}
                  onClick={() => setPayloadText(JSON.stringify(payload, null, 2))}
                  className="rounded-lg border border-[#3A322E] px-2.5 py-1 text-[10px] font-semibold text-[#EAE3D9] hover:border-[#2A9D8F] disabled:opacity-50">
                  {name}
                </button>
              ))}
            </div>
          )}
          {error && <div className="text-[11px] text-[#E76F51]">{error}</div>}
          {onGenerateInsightEvidence && (
            <button type="button" disabled={isDeploying || insightEvidenceRunning}
              onClick={() => void onGenerateInsightEvidence()}
              className="w-full rounded-xl border border-[#9D4EDD]/40 bg-[#9D4EDD]/10 p-3 text-left disabled:opacity-50">
              <span className="flex items-center gap-2 text-[11px] font-semibold text-[#C9A7FF]">
                {insightEvidenceRunning ? <RotateCcw className="h-3.5 w-3.5 animate-spin" /> : <Lightbulb className="h-3.5 w-3.5" />}
                {insightEvidenceRunning ? 'Running four LOW executions…' : 'Generate Insight evidence'}
              </span>
              <span className="mt-1 block text-[10px] text-[#A89F91]">
                Starts four real LOW runs with Gemini. No proposal is approved automatically.
              </span>
            </button>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} disabled={isDeploying} className="px-3 py-2 rounded-lg border border-[#3A322E] text-xs text-[#A89F91]">Cancel</button>
            <button onClick={() => void confirm()} disabled={isDeploying}
              className="px-4 py-2 rounded-lg bg-[#2A9D8F] text-[#101816] text-xs font-semibold flex items-center gap-2 disabled:opacity-50">
              {isDeploying && <RotateCcw className="w-3.5 h-3.5 animate-spin" />}
              {isDeploying ? 'Deploying & starting…' : dryRunPassed ? 'Deploy & Start' : 'Deploy anyway'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
