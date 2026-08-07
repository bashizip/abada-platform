import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Play,
  RotateCcw,
  Table,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Zap,
  Braces,
  Terminal,
  ChevronDown,
} from 'lucide-react';
import { WorkflowFile } from '@/types';
import { deriveDefaultPayload, RunResult } from '@/lib/run/liveRun';

interface RunPanelProps {
  workflow: WorkflowFile;
  isOpen: boolean;
  isRunning: boolean;
  onClose: () => void;
  onRun: (payload: Record<string, any>) => Promise<RunResult>;
  lastResult: RunResult | null;
}

const statusStyles: Record<string, { label: string; cls: string }> = {
  COMPLETED: { label: 'COMPLETED', cls: 'bg-[#90A955]/10 text-[#90A955] border-[#90A955]/30' },
  ACTIVE: { label: 'ACTIVE', cls: 'bg-[#F4A261]/10 text-[#F4A261] border-[#F4A261]/30' },
  FAILED: { label: 'FAILED', cls: 'bg-[#E76F51]/10 text-[#E76F51] border-[#E76F51]/30' },
  CANCELLED: { label: 'CANCELLED', cls: 'bg-[#E76F51]/10 text-[#E76F51] border-[#E76F51]/30' },
};

const formatValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export const RunPanel: React.FC<RunPanelProps> = ({
  workflow,
  isOpen,
  isRunning,
  onClose,
  onRun,
  lastResult,
}) => {
  const defaults = useMemo(() => deriveDefaultPayload(workflow), [workflow]);
  const [payloadText, setPayloadText] = useState<string>(() => JSON.stringify(defaults, null, 2));
  const [payloadError, setPayloadError] = useState<string | null>(null);

  // Re-seed the payload when switching workflows.
  useEffect(() => {
    setPayloadText(JSON.stringify(deriveDefaultPayload(workflow), null, 2));
    setPayloadError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.id]);

  if (!isOpen) return null;

  const parsedPayload = (): Record<string, any> | null => {
    try {
      const trimmed = payloadText.trim();
      if (trimmed === '') return {};
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Payload must be a JSON object, e.g. { "order": { ... } }');
      }
      return parsed;
    } catch (err: any) {
      setPayloadError(err.message || 'Invalid JSON payload');
      return null;
    }
  };

  const handleRun = async () => {
    setPayloadError(null);
    const payload = parsedPayload();
    if (payload === null) return;
    try {
      await onRun(payload);
    } catch (err: any) {
      // onRun resolves with result.error set; this guards against unexpected rejections.
      console.error('Run failed unexpectedly', err);
    }
  };

  const result = lastResult;
  const resultStyle = result ? statusStyles[result.status] || statusStyles.ACTIVE : null;

  return (
    <div className="absolute top-16 right-4 z-30 w-[400px] max-h-[calc(100vh-6rem)] bg-[#25201D] border border-[#3A322E] rounded-2xl shadow-warm-lg flex flex-col overflow-hidden animate-in slide-in-from-top-5">
      {/* Header */}
      <div className="p-3 bg-[#1A1614] border-b border-[#3A322E] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-[#2A9D8F]/15 border border-[#2A9D8F]/30">
            <Zap className="w-4 h-4 text-[#2A9D8F]" />
          </div>
          <div>
            <span className="font-bold text-xs text-[#EAE3D9] tracking-wide">Run on Engine</span>
            <p className="text-[10px] text-[#A89F91] font-mono truncate max-w-[240px]">{workflow.name}</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {isRunning && (
            <span className="text-[10px] bg-[#2A9D8F]/20 text-[#2A9D8F] px-2 py-0.5 rounded-full font-mono animate-pulse flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2A9D8F]" />
              Live
            </span>
          )}
          <button
            onClick={onClose}
            className="text-[#A89F91] hover:text-[#EAE3D9] p-1 rounded hover:bg-[#25201D] transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3 overflow-y-auto flex-1">
        {/* Payload editor */}
        <div className="bg-[#1A1614] border border-[#3A322E] rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-[#3A322E] flex items-center justify-between">
            <span className="text-[10px] font-semibold text-[#F4A261] tracking-wide flex items-center gap-1.5">
              <Braces className="w-3 h-3" />
              INPUT PAYLOAD
            </span>
            <button
              onClick={() => {
                setPayloadText(JSON.stringify(deriveDefaultPayload(workflow), null, 2));
                setPayloadError(null);
              }}
              className="text-[10px] text-[#A89F91] hover:text-[#EAE3D9] px-1.5 py-0.5 rounded hover:bg-[#25201D] transition-all"
              title="Re-derive starter values from the DMN input expressions"
            >
              Reset defaults
            </button>
          </div>
          <textarea
            value={payloadText}
            onChange={(e) => {
              setPayloadText(e.target.value);
              setPayloadError(null);
            }}
            spellCheck={false}
            className={`w-full h-44 bg-transparent p-3 font-mono text-[11px] text-[#EAE3D9] resize-none outline-none focus:bg-[#1A1614] transition-colors ${
              payloadError ? 'ring-1 ring-inset ring-[#E76F51]/60' : ''
            }`}
          />
        </div>

        {payloadError && (
          <div className="flex items-start gap-1.5 text-[11px] text-[#E76F51] bg-[#E76F51]/10 border border-[#E76F51]/30 rounded-lg px-2.5 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {payloadError}
          </div>
        )}

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={isRunning}
          className={`w-full text-xs font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-warm-md ${
            isRunning
              ? 'bg-[#2A9D8F]/40 text-[#1A1614] cursor-not-allowed'
              : 'bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] active:scale-[0.98]'
          }`}
        >
          {isRunning ? (
            <>
              <RotateCcw className="w-3.5 h-3.5 animate-spin" />
              Deploying · Starting · Polling…
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-[#1A1614]" />
              Run Live
            </>
          )}
        </button>

        {/* Result */}
        {result && (
          <div className="space-y-2.5">
            {result.error && (
              <div className="flex items-start gap-1.5 text-[11px] text-[#E76F51] bg-[#E76F51]/10 border border-[#E76F51]/30 rounded-lg px-2.5 py-2">
                <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {result.error}
              </div>
            )}

            {!result.error && resultStyle && (
              <div className="bg-[#1A1614] border border-[#3A322E] rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${resultStyle.cls}`}>
                    {resultStyle.label}
                  </span>
                  <span className="text-[10px] font-mono text-[#A89F91]">
                    {(result.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-[#A89F91]">Instance</span>
                    <span className="font-mono text-[#EAE3D9] truncate ml-2">{result.instanceId}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-[#A89F91]">Definition</span>
                    <span className="font-mono text-[#EAE3D9]">{result.processDefinitionId} · v{result.version}</span>
                  </div>
                  {result.waitingAt && (
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-[#A89F91]">Waiting at</span>
                      <span className="text-[#F4A261] font-medium">{result.waitingAt}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Decision outputs — the deterministic wall, proven by the engine */}
            {result.decisionOutputs.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold text-[#2A9D8F] tracking-wide flex items-center gap-1.5">
                  <Table className="w-3 h-3" />
                  DECISION OUTPUTS · APPLIED IN-TRANSACTION
                </div>
                {result.decisionOutputs.map((d) => (
                  <div key={d.decisionKey} className="bg-[#2A9D8F]/5 border border-[#2A9D8F]/25 rounded-xl p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-[#2A9D8F]">{d.decisionKey}</span>
                      <span className="text-[10px] text-[#A89F91] truncate ml-2">{d.nodeTitle}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(d.outputs).map(([name, value]) => (
                        <span
                          key={name}
                          className="text-[10px] font-mono bg-[#1A1614] border border-[#2A9D8F]/30 text-[#EAE3D9] px-1.5 py-0.5 rounded"
                        >
                          <span className="text-[#2A9D8F]">{name}</span>
                          <span className="text-[#A89F91]"> = </span>
                          {formatValue(value)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Raw variables */}
            {result.variables && Object.keys(result.variables).length > 0 && (
              <details className="bg-[#1A1614] border border-[#3A322E] rounded-xl group">
                <summary className="px-3 py-2 text-[10px] font-semibold text-[#A89F91] tracking-wide cursor-pointer hover:text-[#EAE3D9] transition-colors flex items-center gap-1.5">
                  <Terminal className="w-3 h-3" />
                  INSTANCE VARIABLES
                  <ChevronDown className="w-3 h-3 ml-auto group-open:rotate-180 transition-transform" />
                </summary>
                <pre className="p-3 pt-0 font-mono text-[10px] text-[#EAE3D9] overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(result.variables, null, 2)}
                </pre>
              </details>
            )}

            {!result.error && result.decisionOutputs.length === 0 && (
              <div className="flex items-start gap-1.5 text-[11px] text-[#A89F91] bg-[#1A1614] border border-[#3A322E] rounded-lg px-2.5 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#90A955] shrink-0 mt-0.5" />
                No decision tables were reached on this run. Instance events stream to the audit panel below.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
