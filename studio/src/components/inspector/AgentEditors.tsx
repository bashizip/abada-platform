import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AgentDelegate, CallProcessConfig } from '@/types';
import {
  callProcessProblem, delegatesProblem, limitsProblem, type AgentLimits,
} from '@/lib/apl/agentFields';

const FIELD = 'w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-2 py-1 text-[11px] text-[#EAE3D9] focus:outline-none focus:border-[#9D4EDD]';
const LABEL = 'text-[10px] text-[#A89F91] block';
const ERROR = 'text-[10px] text-[#E76F51]';
const PROCESS_KEY = /^[a-z][a-z0-9_-]{0,127}$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const list = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
const numberOrUndefined = (value: string) => (value.trim() === '' ? undefined : Number(value));

/** `max_turns` per attempt, `max_tokens_total` and `budget_usd` for the whole task. */
export const AgentLimitsEditor: React.FC<{ limits: AgentLimits; onChange: (patch: AgentLimits) => void }> = ({
  limits, onChange,
}) => {
  const problem = limitsProblem(limits);
  return (
    <div className="space-y-1.5">
      <label className={LABEL}>Loop limits — reaching one ends the step with AGENT_BUDGET_EXHAUSTED</label>
      <div className="grid grid-cols-3 gap-2">
        <input aria-label="Max turns" type="number" min={1} max={32} placeholder="turns (8)" className={FIELD}
          value={limits.maxTurns ?? ''} onChange={(event) => onChange({ maxTurns: numberOrUndefined(event.target.value) })} />
        <input aria-label="Max tokens total" type="number" min={1} placeholder="tokens" className={FIELD}
          value={limits.maxTokensTotal ?? ''}
          onChange={(event) => onChange({ maxTokensTotal: numberOrUndefined(event.target.value) })} />
        <input aria-label="Budget USD" type="number" min={0} step="0.01" placeholder="$ budget" className={FIELD}
          value={limits.budgetUsd ?? ''} onChange={(event) => onChange({ budgetUsd: numberOrUndefined(event.target.value) })} />
      </div>
      <p className={LABEL}>Turns count per attempt; tokens and budget cover the whole task. Empty = engine default.</p>
      {problem && <p className={ERROR}>{problem}</p>}
    </div>
  );
};

/** Processes the agent may start as governed children, offered to it as `delegate:<process>` tools. */
export const DelegatesEditor: React.FC<{
  delegates: AgentDelegate[];
  onChange: (delegates: AgentDelegate[] | undefined) => void;
}> = ({ delegates, onChange }) => {
  const [draft, setDraft] = useState('');
  const update = (index: number, patch: Partial<AgentDelegate>) =>
    onChange(delegates.map((delegate, at) => (at === index ? { ...delegate, ...patch } : delegate)));
  const remove = (index: number) => {
    const rest = delegates.filter((_, at) => at !== index);
    onChange(rest.length ? rest : undefined);
  };
  const problem = delegatesProblem(delegates);
  return (
    <div className="space-y-1.5">
      <label className={LABEL}>Delegates — processes the agent may start; only their outputs come back</label>
      {delegates.map((delegate, index) => (
        <div key={delegate.process + index} className="space-y-1 rounded-lg border border-[#3A322E] p-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[#EAE3D9]">delegate:{delegate.process}</span>
            <button type="button" aria-label={`Remove delegate ${delegate.process}`} onClick={() => remove(index)}
              className="ml-auto text-[#A89F91] hover:text-[#E76F51]"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
          <input aria-label={`Outputs of ${delegate.process}`} className={`${FIELD} font-mono`} placeholder="payout_id, status"
            defaultValue={(delegate.outputs ?? []).join(', ')}
            onBlur={(event) => update(index, { outputs: list(event.target.value) })} />
          <input aria-label={`Description of ${delegate.process}`} className={FIELD} placeholder="What the process does"
            value={delegate.description ?? ''} maxLength={500}
            onChange={(event) => update(index, { description: event.target.value || undefined })} />
          <label className="flex items-center gap-1.5 text-[10px] text-[#A89F91]">
            <input type="checkbox" checked={delegate.approval === 'required'}
              onChange={(event) => update(index, event.target.checked
                ? { approval: 'required' } : { approval: undefined, approvers: undefined })} />
            a person approves each delegation first
          </label>
          {delegate.approval === 'required' && (
            <input aria-label={`Approvers of ${delegate.process}`} className={FIELD} placeholder="finance"
              defaultValue={(delegate.approvers ?? []).join(', ')}
              onBlur={(event) => update(index, { approvers: list(event.target.value).length ? list(event.target.value) : undefined })} />
          )}
        </div>
      ))}
      {delegates.length < 8 && (
        <div className="flex gap-2">
          <input aria-label="New delegate process" placeholder="refund_payout" value={draft}
            onChange={(event) => setDraft(event.target.value.trim())} className={`${FIELD} font-mono`} />
          <button type="button" disabled={!PROCESS_KEY.test(draft) || delegates.some((d) => d.process === draft)}
            onClick={() => { onChange([...delegates, { process: draft, outputs: [] }]); setDraft(''); }}
            className="shrink-0 rounded-lg border border-[#3A322E] px-2 text-[11px] text-[#EAE3D9] disabled:opacity-40">
            <Plus className="inline h-3 w-3" /> Add
          </button>
        </div>
      )}
      {problem && <p className={ERROR}>{problem}</p>}
    </div>
  );
};

/** A small editable map: one row per key, with a row to add. */
const PairsEditor: React.FC<{
  label: string;
  pairs: Record<string, string>;
  keyPlaceholder: string;
  valuePlaceholder: string;
  arrow: string;
  onChange: (pairs: Record<string, string>) => void;
}> = ({ label, pairs, keyPlaceholder, valuePlaceholder, arrow, onChange }) => {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const entries = Object.entries(pairs);
  return (
    <div className="space-y-1">
      <label className={LABEL}>{label}</label>
      {entries.map(([name, expression]) => (
        <div key={name} className="flex items-center gap-1.5">
          <span className="w-28 truncate font-mono text-[11px] text-[#EAE3D9]">{name}</span>
          <span className="text-[10px] text-[#A89F91]">{arrow}</span>
          <input aria-label={`${label} ${name}`} className={`${FIELD} font-mono`} value={expression}
            onChange={(event) => onChange({ ...pairs, [name]: event.target.value })} />
          <button type="button" aria-label={`Remove ${name}`} className="text-[#A89F91] hover:text-[#E76F51]"
            onClick={() => onChange(Object.fromEntries(entries.filter(([other]) => other !== name)))}>
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input aria-label={`New ${label} name`} placeholder={keyPlaceholder} value={key}
          onChange={(event) => setKey(event.target.value.trim())} className={`${FIELD} w-28 font-mono`} />
        <span className="text-[10px] text-[#A89F91]">{arrow}</span>
        <input aria-label={`New ${label} value`} placeholder={valuePlaceholder} value={value}
          onChange={(event) => setValue(event.target.value)} className={`${FIELD} font-mono`} />
        <button type="button" disabled={!VARIABLE.test(key) || !value.trim() || key in pairs}
          onClick={() => { onChange({ ...pairs, [key]: value.trim() }); setKey(''); setValue(''); }}
          className="shrink-0 rounded-lg border border-[#3A322E] px-2 text-[11px] text-[#EAE3D9] disabled:opacity-40">Add</button>
      </div>
    </div>
  );
};

/** A call-process step: the pinned child, its inputs (CEL) and the outputs mapped back. */
export const CallProcessEditor: React.FC<{
  config: CallProcessConfig;
  onChange: (config: CallProcessConfig) => void;
}> = ({ config, onChange }) => {
  const problem = callProcessProblem(config);
  const inputs = Object.fromEntries(Object.entries(config.inputs ?? {}).map(([name, value]) => [name, String(value)]));
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className={LABEL}>Process to call (its version is fixed when this process is deployed)</label>
        <input aria-label="Called process" className={`${FIELD} font-mono`} placeholder="fraud_check" value={config.process ?? ''}
          onChange={(event) => onChange({ ...config, process: event.target.value.trim() })} />
      </div>
      <PairsEditor label="Inputs" arrow="=" keyPlaceholder="child_var" valuePlaceholder="amount * 1.2"
        pairs={inputs} onChange={(next) => onChange({ ...config, inputs: Object.keys(next).length ? next : undefined })} />
      <PairsEditor label="Outputs" arrow="←" keyPlaceholder="parent_var" valuePlaceholder="child_var"
        pairs={config.outputs ?? {}} onChange={(next) => onChange({ ...config, outputs: next })} />
      <div className="space-y-1">
        <label className={LABEL}>Max depth (optional, tighter than the engine's)</label>
        <input aria-label="Max depth" type="number" min={1} max={10} className={FIELD} value={config.maxDepth ?? ''}
          onChange={(event) => onChange({ ...config, maxDepth: numberOrUndefined(event.target.value) })} />
      </div>
      {problem && <p className={ERROR}>{problem}</p>}
    </div>
  );
};
