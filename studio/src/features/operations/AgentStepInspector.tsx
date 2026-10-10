import React, { useState } from 'react';
import { AlertTriangle, Bot, GitBranch, Lock, Wrench } from 'lucide-react';
import { EvidenceAPI, formatUsd, type AgentStepEvidence, type AgentStepPayloads } from '@/api/evidence';
import { stepTotals } from './agentSteps';

interface AgentStepInspectorProps {
  steps: AgentStepEvidence[];
  projectId?: string;
  instanceId?: string;
  onOpenInstance?: (instanceId: string) => void;
}

const KIND: Record<AgentStepEvidence['kind'], { label: string; icon: React.ReactNode }> = {
  MODEL_CALL: { label: 'model', icon: <Bot className="h-3 w-3" aria-hidden /> },
  TOOL_CALL: { label: 'tool', icon: <Wrench className="h-3 w-3" aria-hidden /> },
  DELEGATION: { label: 'delegation', icon: <GitBranch className="h-3 w-3" aria-hidden /> },
};

const STATE_TONE: Record<string, string> = {
  COMPLETED: 'text-[#2A9D8F]',
  FAILED: 'text-[#E76F51]',
  OUTCOME_UNKNOWN: 'text-[#1A1614] bg-[#E76F51] px-1 rounded',
  PROPOSED: 'text-[#F4A261]',
  APPROVED: 'text-[#2A9D8F]',
  REJECTED: 'text-[#E76F51]',
  STARTED: 'text-[#9D4EDD]',
};

const policyLabel = (policy?: string) => (policy === 'approval_required' ? 'approval required'
  : policy === 'delegate' ? undefined : policy);

const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString() : '');

/**
 * Every model call, tool call and delegation of an agent, attempt by attempt:
 * policy and approval state, unknown write outcomes, tokens and cost. The
 * payloads (as the evidence policy kept them) open on demand for evidence
 * readers; each read is recorded in the instance history.
 */
export const AgentStepInspector: React.FC<AgentStepInspectorProps> = ({ steps, projectId, instanceId, onOpenInstance }) => {
  const [open, setOpen] = useState<string | null>(null);
  const [payloads, setPayloads] = useState<Record<string, AgentStepPayloads>>({});
  const [denied, setDenied] = useState<string | null>(null);
  if (steps.length === 0) return null;

  const attempts = [...new Set(steps.map((step) => step.attempt))].sort((a, b) => a - b);
  const total = stepTotals(steps);

  const showPayloads = async (step: AgentStepEvidence) => {
    if (open === step.id) { setOpen(null); return; }
    setOpen(step.id);
    setDenied(null);
    if (payloads[step.id] || !projectId || !instanceId) return;
    try {
      const read = await EvidenceAPI.payloads(projectId, instanceId, step.id);
      setPayloads((current) => ({ ...current, [step.id]: read }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setDenied(message.startsWith('403')
        ? 'Reading payloads needs the abada-evidence-reader role (or the agent-evidence:read scope).'
        : message.startsWith('410') ? 'These payloads were purged after the retention period.' : message);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-[#3A322E] bg-[#14110D] p-2" aria-label="Agent steps">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-[#A89F91]">
        <span>Steps ({steps.length})</span>
        <span className="font-mono normal-case">
          {total.tokens.toLocaleString()} tokens · {formatUsd(total.usd)}
          {total.unpriced && <span className="ml-1 text-[#F4A261]">+ unpriced</span>}
        </span>
      </div>
      {attempts.map((attempt) => {
        const ofAttempt = steps.filter((step) => step.attempt === attempt)
          .sort((a, b) => a.sequence - b.sequence);
        const subtotal = stepTotals(ofAttempt);
        return (
          <div key={attempt} className="mt-1">
            <div className="flex items-center justify-between text-[10px] text-[#A89F91]">
              <span>Attempt {attempt}</span>
              <span className="font-mono">{formatUsd(subtotal.usd)}{subtotal.unpriced ? ' + unpriced' : ''}</span>
            </div>
            <ul className="space-y-0.5 text-[11px]">
              {ofAttempt.map((step) => {
                const kind = KIND[step.kind] ?? KIND.TOOL_CALL;
                const policy = policyLabel(step.policy);
                return (
                  <li key={step.id} className="rounded border border-transparent hover:border-[#3A322E]">
                    <button type="button" onClick={() => void showPayloads(step)}
                      className="flex w-full items-center gap-2 px-1 py-0.5 text-left text-[#EAE3D9]"
                      aria-expanded={open === step.id} aria-label={`Step ${step.attempt}.${step.sequence}`}>
                      <span className="font-mono text-[10px] text-[#A89F91]">{step.attempt}.{step.sequence}</span>
                      <span className="flex items-center gap-1 text-[10px] text-[#A89F91]">{kind.icon}{kind.label}</span>
                      <span className="truncate">{step.kind === 'MODEL_CALL' ? step.model ?? 'model' : step.toolRef}</span>
                      {policy && <span className="rounded border border-[#3A322E] px-1 text-[9px] text-[#A89F91]">{policy}</span>}
                      <span className={`text-[10px] ${STATE_TONE[step.state] ?? 'text-[#A89F91]'}`}>
                        {step.state === 'OUTCOME_UNKNOWN' && <AlertTriangle className="mr-0.5 inline h-3 w-3" aria-hidden />}
                        {step.state.toLowerCase().replace('_', ' ')}
                      </span>
                      <span className="ml-auto font-mono text-[10px]">
                        {step.promptTokens !== undefined && step.promptTokens !== null
                          ? `${(step.promptTokens ?? 0) + (step.completionTokens ?? 0)} tok ` : ''}
                        {step.costUnpriced ? <span className="text-[#F4A261]">unpriced</span>
                          : step.costUsd !== undefined && step.costUsd !== null ? formatUsd(step.costUsd) : ''}
                      </span>
                    </button>
                    {(step.resolvedBy || step.childInstanceId) && (
                      <div className="flex flex-wrap gap-2 px-6 text-[10px] text-[#A89F91]">
                        {step.resolvedBy && (
                          <span>{step.state === 'REJECTED' ? 'rejected' : 'approved'} by {step.resolvedBy}
                            {step.decidedAt ? ` at ${time(step.decidedAt)}` : ''}</span>
                        )}
                        {step.childInstanceId && (onOpenInstance ? (
                          <button type="button" className="underline hover:text-[#EAE3D9]"
                            onClick={() => onOpenInstance(step.childInstanceId!)}>
                            child {step.childInstanceId.slice(0, 8)}
                          </button>
                        ) : <span>child {step.childInstanceId.slice(0, 8)}</span>)}
                      </div>
                    )}
                    {open === step.id && (
                      <div className="mx-1 mb-1 rounded bg-[#1A1614] p-2 text-[10px]">
                        {denied ? (
                          <p className="flex items-center gap-1 text-[#F4A261]"><Lock className="h-3 w-3" aria-hidden />{denied}</p>
                        ) : payloads[step.id] ? (
                          <PayloadView payloads={payloads[step.id]} />
                        ) : (
                          <p className="text-[#A89F91]">Loading payloads…</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
};

const PayloadView: React.FC<{ payloads: AgentStepPayloads }> = ({ payloads }) => {
  if (payloads.payloadMode === 'none') {
    return <p className="text-[#A89F91]">This project keeps no payloads (evidence policy: none).</p>;
  }
  return (
    <div className="space-y-1">
      {payloads.payloadMode === 'redacted' && <p className="text-[#A89F91]">Sensitive values are redacted.</p>}
      {(['request', 'result'] as const).map((part) => (
        <div key={part}>
          <p className="uppercase tracking-wider text-[#A89F91]">{part}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[#EAE3D9]">
            {payloads[part] === undefined || payloads[part] === null ? '—' : JSON.stringify(payloads[part], null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
};
