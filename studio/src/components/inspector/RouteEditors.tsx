import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { LoopConfig, OnErrorRoute, OnTimeoutRoute, ReviewOutcome, WorkflowNode } from '@/types';
import { OUTCOME_NAME, outcomesProblem, timeoutError } from '@/lib/apl/routes';
import { loopProblemMessage, type LoopProblem } from '@/lib/apl/loopAnalysis';

const FIELD = 'w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-2 py-1.5 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#E76F51]';
const SELECT = `${FIELD} font-mono`;
const LABEL = 'text-[10px] text-[#A89F91] block';
const ERROR = 'text-[10px] text-[#E76F51]';

/** Targets a route can point at: every other node, by title. */
export const TargetOptions: React.FC<{ nodes: WorkflowNode[]; excludeId: string }> = ({ nodes, excludeId }) => (
  <>
    {nodes.filter((node) => node.id !== excludeId).map((node) => (
      <option key={node.id} value={node.id}>{node.title || node.id}</option>
    ))}
  </>
);

export const RouteSelect: React.FC<{
  label: string;
  value?: string;
  nodes: WorkflowNode[];
  excludeId: string;
  onChange: (target: string | null) => void;
}> = ({ label, value, nodes, excludeId, onChange }) => (
  <div className="space-y-1">
    <label className={LABEL}>{label}</label>
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} className={SELECT} aria-label={label}>
      <option value="">— no route —</option>
      <TargetOptions nodes={nodes} excludeId={excludeId} />
    </select>
  </div>
);

/** `on_timeout`: a duration (validated like the engine) and where the flow continues. */
export const TimeoutEditor: React.FC<{
  value?: OnTimeoutRoute;
  nodes: WorkflowNode[];
  excludeId: string;
  onChange: (after: string, target: string | null) => void;
}> = ({ value, nodes, excludeId, onChange }) => {
  const [after, setAfter] = useState(value?.after ?? 'PT1H');
  useEffect(() => { setAfter(value?.after ?? 'PT1H'); }, [value?.after]);
  const problem = timeoutError(after);
  return (
    <div className="space-y-1">
      <label className={LABEL}>Timeout (on_timeout) — cancels the step and continues elsewhere</label>
      <div className="flex gap-2">
        <input
          aria-label="Timeout duration"
          value={after}
          onChange={(event) => setAfter(event.target.value)}
          onBlur={() => { if (!problem && value?.then) onChange(after.trim().toUpperCase(), value.then); }}
          className={`${FIELD} w-24 font-mono`}
        />
        <select
          aria-label="Timeout target"
          value={value?.then ?? ''}
          disabled={!!problem}
          onChange={(event) => onChange(after.trim().toUpperCase(), event.target.value || null)}
          className={SELECT}
        >
          <option value="">— no timeout —</option>
          <TargetOptions nodes={nodes} excludeId={excludeId} />
        </select>
      </div>
      {problem && <p className={ERROR}>{problem}</p>}
    </div>
  );
};

/** `on_error`: a catch-all target and/or one target per error code. */
export const ErrorRoutesEditor: React.FC<{
  value?: OnErrorRoute;
  nodes: WorkflowNode[];
  excludeId: string;
  onSetRule: (code: string | undefined, target: string | null) => void;
}> = ({ value, nodes, excludeId, onSetRule }) => {
  const rules = typeof value === 'string' ? [{ then: value }] : value ?? [];
  const catchAll = rules.find((rule) => !rule.code);
  const coded = rules.filter((rule) => rule.code);
  const [code, setCode] = useState('');
  const codeProblem = code && !/^[A-Za-z0-9_.:-]{1,128}$/.test(code) ? 'Letters, digits and . _ : - only'
    : coded.some((rule) => rule.code === code) ? 'This code already has a route' : null;
  return (
    <div className="space-y-1.5">
      <label className={LABEL}>Error routes (on_error) — a reported error, or the last failed attempt</label>
      {coded.map((rule) => (
        <div key={rule.code} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate font-mono text-[10px] text-[#EAE3D9]" title={rule.code}>{rule.code}</span>
          <select aria-label={`Route for error ${rule.code}`} value={rule.then} onChange={(event) => onSetRule(rule.code, event.target.value || null)} className={SELECT}>
            <TargetOptions nodes={nodes} excludeId={excludeId} />
          </select>
          <button onClick={() => onSetRule(rule.code, null)} aria-label={`Remove route for ${rule.code}`} className="text-[#A89F91] hover:text-[#E76F51]">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-[10px] text-[#A89F91]">any other error</span>
        <select aria-label="Route for any error" value={catchAll?.then ?? ''} onChange={(event) => onSetRule(undefined, event.target.value || null)} className={SELECT}>
          <option value="">— incident —</option>
          <TargetOptions nodes={nodes} excludeId={excludeId} />
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input aria-label="New error code" placeholder="ERROR_CODE" value={code} onChange={(event) => setCode(event.target.value.trim())} className={`${FIELD} w-24 font-mono`} />
        <select
          aria-label="Route for the new error code"
          value=""
          disabled={!code || !!codeProblem}
          onChange={(event) => { if (event.target.value) { onSetRule(code, event.target.value); setCode(''); } }}
          className={SELECT}
        >
          <option value="">— route this code to… —</option>
          <TargetOptions nodes={nodes} excludeId={excludeId} />
        </select>
      </div>
      {codeProblem && <p className={ERROR}>{codeProblem}</p>}
    </div>
  );
};

/**
 * A review's `outcomes`: decisions the reviewer chooses from, each with its
 * target and whether it needs a comment. Turning outcomes on replaces the
 * task's `next` (its target becomes the first outcome's).
 */
export const OutcomesEditor: React.FC<{
  outcomes?: Record<string, ReviewOutcome>;
  nextTarget?: string;
  nodes: WorkflowNode[];
  excludeId: string;
  onChange: (outcomes: Record<string, ReviewOutcome> | undefined) => void;
}> = ({ outcomes, nextTarget, nodes, excludeId, onChange }) => {
  const [draftName, setDraftName] = useState('');
  if (!outcomes || Object.keys(outcomes).length === 0) {
    return (
      <button
        onClick={() => onChange({
          approve: { next: nextTarget ?? '' },
          reject: { next: '', comment: 'required' },
        })}
        className="flex items-center gap-1 text-[11px] text-[#F4A261] hover:underline"
      >
        <Plus className="h-3 w-3" /> Ask for a decision (approve / reject)
      </button>
    );
  }
  const entries = Object.entries(outcomes);
  const problem = outcomesProblem(outcomes);
  const update = (name: string, patch: Partial<ReviewOutcome>) =>
    onChange({ ...outcomes, [name]: { ...outcomes[name], ...patch } });
  const rename = (from: string, to: string) => {
    if (!to || to === from || outcomes[to]) return;
    onChange(Object.fromEntries(entries.map(([name, outcome]) => [name === from ? to : name, outcome])));
  };
  const remove = (name: string) => {
    const rest = Object.fromEntries(entries.filter(([candidate]) => candidate !== name));
    onChange(Object.keys(rest).length ? rest : undefined);
  };
  return (
    <div className="space-y-1.5">
      <label className={LABEL}>Review outcomes — the reviewer picks one; each has its own next step</label>
      {entries.map(([name, outcome]) => (
        <div key={name} className="space-y-1 rounded-lg border border-[#3A322E] p-2">
          <div className="flex items-center gap-2">
            <input
              aria-label={`Outcome ${name} name`}
              defaultValue={name}
              onBlur={(event) => rename(name, event.target.value.trim())}
              className={`${FIELD} w-28 font-mono`}
            />
            <select aria-label={`Outcome ${name} target`} value={outcome.next} onChange={(event) => update(name, { next: event.target.value })} className={SELECT}>
              <option value="">— choose —</option>
              <TargetOptions nodes={nodes} excludeId={excludeId} />
            </select>
            <button onClick={() => remove(name)} aria-label={`Remove outcome ${name}`} className="text-[#A89F91] hover:text-[#E76F51]">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-[#A89F91]">
            <input
              type="checkbox"
              checked={outcome.comment === 'required'}
              onChange={(event) => update(name, { comment: event.target.checked ? 'required' : undefined })}
            />
            comment required
          </label>
        </div>
      ))}
      {entries.length < 6 && (
        <div className="flex gap-2">
          <input aria-label="New outcome name" placeholder="request_changes" value={draftName}
            onChange={(event) => setDraftName(event.target.value.trim())} className={`${FIELD} font-mono`} />
          <button
            disabled={!OUTCOME_NAME.test(draftName) || !!outcomes[draftName]}
            onClick={() => { onChange({ ...outcomes, [draftName]: { next: '' } }); setDraftName(''); }}
            className="shrink-0 rounded-lg border border-[#3A322E] px-2 text-[11px] text-[#EAE3D9] disabled:opacity-40"
          >
            Add
          </button>
        </div>
      )}
      {problem && <p className={ERROR}>{problem}</p>}
    </div>
  );
};

/** `loop`: how many times the step may run per pass, and where to go past that. */
export const LoopEditor: React.FC<{
  loop?: LoopConfig;
  problem?: LoopProblem | null;
  nodes: WorkflowNode[];
  excludeId: string;
  onChange: (loop: LoopConfig | undefined) => void;
}> = ({ loop, problem, nodes, excludeId, onChange }) => {
  const [raw, setRaw] = useState(String(loop?.maxIterations ?? 3));
  useEffect(() => { setRaw(String(loop?.maxIterations ?? 3)); }, [loop?.maxIterations]);
  const value = Number(raw);
  const invalid = !Number.isInteger(value) || value < 1 || value > 1000;
  return (
    <div className="space-y-1.5">
      {problem && problem !== 'unbounded' && <p className={ERROR}>{loopProblemMessage(problem)}</p>}
      {!loop ? (
        <>
          {problem === 'unbounded' && <p className={ERROR}>{loopProblemMessage(problem)}</p>}
          <button
            onClick={() => onChange({ maxIterations: 3 })}
            className={`flex items-center gap-1 text-[11px] ${problem === 'unbounded' ? 'font-semibold text-[#E76F51]' : 'text-[#F4A261]'} hover:underline`}
          >
            <Plus className="h-3 w-3" /> Add loop bound
          </button>
        </>
      ) : (
        <>
          <label className={LABEL}>Repeat limit (loop) — runs at most this many times per pass</label>
          <div className="flex gap-2">
            <input
              aria-label="Maximum iterations"
              type="number"
              min={1}
              max={1000}
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              onBlur={() => { if (!invalid) onChange({ ...loop, maxIterations: value }); }}
              className={`${FIELD} w-20`}
            />
            <select
              aria-label="When the limit is reached"
              value={loop.onExhausted ?? ''}
              onChange={(event) => onChange({ ...loop, onExhausted: event.target.value || undefined })}
              className={SELECT}
            >
              <option value="">— open an incident —</option>
              <TargetOptions nodes={nodes} excludeId={excludeId} />
            </select>
            <button onClick={() => onChange(undefined)} aria-label="Remove loop bound" className="text-[#A89F91] hover:text-[#E76F51]">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {invalid && <p className={ERROR}>Use a whole number between 1 and 1000.</p>}
        </>
      )}
    </div>
  );
};

/** An ordered list of values picked from `options` (fallback models). */
export const OrderedPickList: React.FC<{
  label: string;
  value: string[];
  options: string[];
  max: number;
  onChange: (value: string[]) => void;
}> = ({ label, value, options, max, onChange }) => {
  const available = options.filter((option) => !value.includes(option));
  return (
    <div className="space-y-1">
      <label className={LABEL}>{label}</label>
      {value.map((item, index) => (
        <div key={item} className="flex items-center gap-2 text-[11px] font-mono text-[#EAE3D9]">
          <span className="w-4 text-[#A89F91]">{index + 1}.</span>
          <span className="flex-1 truncate">{item}</span>
          <button onClick={() => onChange(value.filter((candidate) => candidate !== item))} aria-label={`Remove ${item}`} className="text-[#A89F91] hover:text-[#E76F51]">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {value.length < max && available.length > 0 && (
        <select aria-label={`Add to ${label}`} value="" onChange={(event) => { if (event.target.value) onChange([...value, event.target.value]); }} className={SELECT}>
          <option value="">— add —</option>
          {available.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      )}
    </div>
  );
};

/** A list of free-text names (groups). */
export const NameListEditor: React.FC<{
  label: string;
  value: string[];
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string[]) => void;
}> = ({ label, value, placeholder, disabled, onChange }) => {
  const [draft, setDraft] = useState('');
  return (
    <div className="space-y-1">
      <label className={LABEL}>{label}</label>
      <div className="flex flex-wrap gap-1">
        {value.map((item) => (
          <span key={item} className="flex items-center gap-1 rounded-full border border-[#3A322E] px-2 py-0.5 text-[10px] text-[#EAE3D9]">
            {item}
            <button onClick={() => onChange(value.filter((candidate) => candidate !== item))} aria-label={`Remove ${item}`} disabled={disabled}>×</button>
          </span>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (draft && !value.includes(draft)) onChange([...value, draft]);
        setDraft('');
      }}>
        <input aria-label={`Add to ${label}`} disabled={disabled} placeholder={placeholder} value={draft}
          onChange={(event) => setDraft(event.target.value.trim())} className={FIELD} />
        <button type="submit" disabled={disabled || !draft} className="shrink-0 rounded-lg border border-[#3A322E] px-2 text-[11px] text-[#EAE3D9] disabled:opacity-40">
          Add
        </button>
      </form>
    </div>
  );
};
