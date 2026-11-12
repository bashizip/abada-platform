import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Copy, GripVertical, Maximize2, Plus, Trash2 } from 'lucide-react';
import type { AplValidationIssue } from '@/api/apl';
import type { DMNConfig, DMNRule, DMNValue } from '@/types';
import type { APLHitPolicy } from '@/lib/apl/types';
import { issuesAt } from '@/lib/apl/issues';
import { Drawer } from '@/components/ui';
import { Field, FieldIssues, Section } from './InspectorKit';
import { MONO_INPUT } from './fieldStyles';
import type { NodeEditorProps } from './nodeEditor';
import {
  addOutputColumn, displayOrder, formatValue, moveRule, outputColumns, parseValue, removeOutputColumn,
  renameOutputColumn, setRuleOutput, valueKind,
} from './decisionTable';

/** Exhaustive over the schema-generated hit policies: a schema change fails the build here. */
const HIT_POLICY: Record<APLHitPolicy, { label: string; help: string }> = {
  FIRST: {
    label: 'First match',
    help: 'Rules are checked top to bottom and the first that matches decides. Order matters.',
  },
  UNIQUE: {
    label: 'Unique match',
    help: 'At most one rule may match; if two do, the step fails. Order does not matter.',
  },
  COLLECT: {
    label: 'Collect all',
    help: 'Every matching rule applies, top to bottom; a later rule overwrites an output an earlier one set.',
  },
};

const KIND_TONE: Record<ReturnType<typeof valueKind>, string> = {
  text: 'text-linen',
  number: 'text-mineral-teal',
  boolean: 'text-amethyst',
};

/**
 * One output value. Typed as text, a number (`42`), a boolean (`true`) or a
 * quoted string (`"42"`); empty removes the output from the rule. The draft is
 * kept while typing so `1.` can become `1.5`.
 */
const ValueCell: React.FC<{ value?: DMNValue; label: string; onChange: (value: DMNValue | undefined) => void }> = ({
  value, label, onChange,
}) => {
  const [draft, setDraft] = useState(() => formatValue(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(formatValue(value));
  }, [value, focused]);
  const kind = valueKind(value);
  return (
    <input aria-label={label} value={draft} placeholder="—"
      title={value === undefined ? 'Not set by this rule' : `${kind} value`}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setDraft(formatValue(value)); }}
      onChange={(event) => { setDraft(event.target.value); onChange(parseValue(event.target.value)); }}
      className={`${MONO_INPUT} ${KIND_TONE[kind]}`} />
  );
};

/** An output column's name, renamed on blur so a half-typed name never splits the column. */
const ColumnName: React.FC<{ name: string; onRename: (name: string) => void; onRemove: () => void }> = ({
  name, onRename, onRemove,
}) => {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    else setDraft(name);
  };
  return (
    <div className="group flex items-center gap-1">
      <input aria-label={`Output name ${name}`} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={`${MONO_INPUT} font-semibold`} />
      <button type="button" aria-label={`Remove output ${name}`} title="Remove this output from every rule" onClick={onRemove}
        className="shrink-0 text-sand opacity-0 transition-opacity hover:text-desert-rose group-hover:opacity-100 focus-visible:opacity-100">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
};

interface RuleListProps {
  config: DMNConfig;
  columns: string[];
  issues: AplValidationIssue[];
  layout: 'compact' | 'table';
  onChange: (config: DMNConfig) => void;
}

/** The rules, in the order the engine reads them, each with its issues; the fallback last. */
const RuleList: React.FC<RuleListProps> = ({ config, columns, issues, layout, onChange }) => {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const ordered = displayOrder(config.rules);
  const conditional = ordered.filter((rule) => !rule.otherwise);
  const fallbacks = ordered.filter((rule) => rule.otherwise);
  const indexOf = (rule: DMNRule) => config.rules.indexOf(rule);
  const setRules = (rules: DMNRule[]) => onChange({ ...config, rules });
  const updateRule = (rule: DMNRule, patch: Partial<DMNRule>) =>
    setRules(config.rules.map((candidate) => (candidate === rule ? { ...candidate, ...patch } : candidate)));
  const move = (from: number, to: number) => setRules(moveRule(config.rules, from, to));
  const duplicate = (rule: DMNRule) => {
    const at = conditional.indexOf(rule);
    const copy: DMNRule = { ...rule, id: `r-${Date.now()}`, then: { ...rule.then } };
    setRules([...conditional.slice(0, at + 1), copy, ...conditional.slice(at + 1), ...fallbacks]);
  };
  const remove = (rule: DMNRule) => setRules(config.rules.filter((candidate) => candidate !== rule));

  const outputs = (rule: DMNRule, number: string) => (
    columns.length === 0
      ? <p className="text-[10px] text-sand">Add an output to say what this rule decides.</p>
      : columns.map((column) => (
        <label key={column} className={layout === 'compact' ? 'grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-1.5' : 'block'}>
          {layout === 'compact' && <span className="truncate font-mono text-[10px] text-sand" title={column}>{column}</span>}
          <ValueCell value={rule.then[column]} label={`${column} for rule ${number}`}
            onChange={(value) => updateRule(rule, { then: setRuleOutput(rule.then, column, value) })} />
        </label>
      ))
  );

  const actions = (rule: DMNRule, position: number) => (
    <div className="flex shrink-0 items-center gap-0.5 text-sand">
      <button type="button" aria-label={`Move rule ${position + 1} up`} title="Move up" disabled={position === 0}
        onClick={() => move(position, position - 1)} className="rounded p-1 hover:bg-mocha-hover hover:text-linen disabled:opacity-30">
        <ArrowUp className="h-3 w-3" />
      </button>
      <button type="button" aria-label={`Move rule ${position + 1} down`} title="Move down" disabled={position === conditional.length - 1}
        onClick={() => move(position, position + 1)} className="rounded p-1 hover:bg-mocha-hover hover:text-linen disabled:opacity-30">
        <ArrowDown className="h-3 w-3" />
      </button>
      <button type="button" aria-label={`Duplicate rule ${position + 1}`} title="Duplicate" onClick={() => duplicate(rule)}
        className="rounded p-1 hover:bg-mocha-hover hover:text-linen">
        <Copy className="h-3 w-3" />
      </button>
      <button type="button" aria-label={`Delete rule ${position + 1}`} title="Delete" onClick={() => remove(rule)}
        className="rounded p-1 hover:bg-mocha-hover hover:text-desert-rose">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );

  const dragProps = (position: number) => ({
    onDragOver: (event: React.DragEvent) => {
      if (dragging === null) return;
      event.preventDefault();
      setOver(position);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      if (dragging !== null && dragging !== position) move(dragging, position);
      setDragging(null);
      setOver(null);
    },
  });

  const handle = (position: number) => (
    <span draggable aria-label={`Drag rule ${position + 1}`} role="button" tabIndex={0}
      title="Drag to reorder (or Alt + arrow keys)"
      onDragStart={(event) => { setDragging(position); event.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { setDragging(null); setOver(null); }}
      onKeyDown={(event) => {
        if (!event.altKey) return;
        if (event.key === 'ArrowUp' && position > 0) { event.preventDefault(); move(position, position - 1); }
        if (event.key === 'ArrowDown' && position < conditional.length - 1) { event.preventDefault(); move(position, position + 1); }
      }}
      className="cursor-grab rounded p-0.5 text-sand hover:text-linen focus-visible:outline focus-visible:outline-1 focus-visible:outline-saffron active:cursor-grabbing">
      <GripVertical className="h-3.5 w-3.5" />
    </span>
  );

  const when = (rule: DMNRule, number: number) => (
    <input aria-label={`Condition of rule ${number}`} value={rule.when ?? ''} placeholder={
      config.inputs.length ? `${config.inputs[0].name} > 0` : 'Declare an input first'}
      onChange={(event) => updateRule(rule, { when: event.target.value })} className={MONO_INPUT} />
  );

  const addRule = () => setRules([...conditional,
    { id: `r-${Date.now()}`, when: '', then: {} }, ...fallbacks]);
  const addFallback = () => setRules([...config.rules,
    { id: `r-${Date.now()}`, otherwise: true, then: {} }]);

  const fallbackRows = fallbacks.map((rule) => {
    const ruleIssues = issuesAt(issues, 'rules', indexOf(rule));
    return layout === 'compact' ? (
      <div key={rule.id} data-rule-index={indexOf(rule)}
        className={`space-y-1.5 rounded-xl border border-dashed bg-charcoal p-2.5 ${ruleIssues.length ? 'border-desert-rose/60' : 'border-hairline'}`}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-linen">Otherwise <span className="font-normal text-sand">· when no rule matches</span></span>
          <button type="button" aria-label="Delete fallback rule" title="Delete" onClick={() => remove(rule)}
            className="rounded p-1 text-sand hover:bg-mocha-hover hover:text-desert-rose"><Trash2 className="h-3 w-3" /></button>
        </div>
        {outputs(rule, 'otherwise')}
        <FieldIssues issues={ruleIssues} />
      </div>
    ) : (
      <tr key={rule.id} data-rule-index={indexOf(rule)} className="border-t border-dashed border-hairline align-top">
        <td />
        <td className="px-2 py-2 text-[11px] font-semibold text-linen" colSpan={2}>
          Otherwise <span className="font-normal text-sand">· when no rule matches</span>
          <FieldIssues issues={ruleIssues} />
        </td>
        {columns.map((column) => (
          <td key={column} className="px-1 py-1.5">
            <ValueCell value={rule.then[column]} label={`${column} for rule otherwise`}
              onChange={(value) => updateRule(rule, { then: setRuleOutput(rule.then, column, value) })} />
          </td>
        ))}
        <td className="px-1 py-1.5 text-right">
          <button type="button" aria-label="Delete fallback rule" onClick={() => remove(rule)}
            className="rounded p-1 text-sand hover:bg-mocha-hover hover:text-desert-rose"><Trash2 className="h-3 w-3" /></button>
        </td>
      </tr>
    );
  });

  const footer = (
    <div className="flex gap-2">
      <button type="button" onClick={addRule}
        className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-mineral-teal/40 bg-mineral-teal/10 py-1.5 text-[11px] font-semibold text-mineral-teal hover:bg-mineral-teal/20">
        <Plus className="h-3 w-3" /> Add rule
      </button>
      {fallbacks.length === 0 && (
        <button type="button" onClick={addFallback}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-dashed border-hairline py-1.5 text-[11px] font-semibold text-sand hover:text-linen">
          <Plus className="h-3 w-3" /> Add fallback
        </button>
      )}
    </div>
  );

  if (layout === 'compact') {
    return (
      <div className="space-y-2">
        {conditional.map((rule, position) => {
          const ruleIssues = issuesAt(issues, 'rules', indexOf(rule));
          return (
            <div key={rule.id} data-rule-index={indexOf(rule)} {...dragProps(position)}
              className={`space-y-1.5 rounded-xl border bg-charcoal p-2.5 transition-colors duration-[var(--duration-fast)] ${
                ruleIssues.length ? 'border-desert-rose/60' : over === position && dragging !== position ? 'border-saffron' : 'border-hairline'
              } ${dragging === position ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-1.5">
                {handle(position)}
                <span className="font-mono text-[10px] text-mineral-teal">Rule {position + 1}</span>
                <span className="flex-1" />
                {actions(rule, position)}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-9 shrink-0 text-[10px] uppercase tracking-wider text-sand">When</span>
                {when(rule, position + 1)}
              </div>
              <div className="space-y-1 border-l border-hairline pl-2">{outputs(rule, String(position + 1))}</div>
              <FieldIssues issues={ruleIssues} />
            </div>
          );
        })}
        {conditional.length === 0 && (
          <p className="rounded-xl border border-dashed border-hairline p-3 text-center text-[11px] text-sand">
            No rules yet. A rule says: when this condition holds, set these outputs.
          </p>
        )}
        {fallbackRows}
        {footer}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <table className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col className="w-7" />
          <col className="w-10" />
          <col />
          {columns.map((column) => <col key={column} className="w-36" />)}
          <col className="w-28" />
        </colgroup>
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-sand">
            <th /><th className="px-2 py-1">#</th><th className="px-2 py-1">When</th>
            {columns.map((column) => <th key={column} className="px-1 py-1 font-mono normal-case tracking-normal text-linen">{column}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {conditional.map((rule, position) => {
            const ruleIssues = issuesAt(issues, 'rules', indexOf(rule));
            return (
              <tr key={rule.id} data-rule-index={indexOf(rule)} {...dragProps(position)}
                className={`border-t align-top ${ruleIssues.length ? 'border-desert-rose/60 bg-desert-rose/5'
                  : over === position && dragging !== position ? 'border-saffron' : 'border-hairline'} ${dragging === position ? 'opacity-50' : ''}`}>
                <td className="py-2 pl-1">{handle(position)}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-mineral-teal">{position + 1}</td>
                <td className="px-1 py-1.5">{when(rule, position + 1)}<FieldIssues issues={ruleIssues} /></td>
                {columns.map((column) => (
                  <td key={column} className="px-1 py-1.5">
                    <ValueCell value={rule.then[column]} label={`${column} for rule ${position + 1}`}
                      onChange={(value) => updateRule(rule, { then: setRuleOutput(rule.then, column, value) })} />
                  </td>
                ))}
                <td className="px-1 py-1.5">{actions(rule, position)}</td>
              </tr>
            );
          })}
          {fallbackRows}
        </tbody>
      </table>
      {footer}
    </div>
  );
};

/**
 * A decision table: inputs resolved from the instance, ordered rules whose
 * conditions see only those inputs, and the outputs each rule sets. The engine
 * evaluates it in the workflow transaction; no model is involved.
 */
export const DecisionTableEditor: React.FC<NodeEditorProps> = ({ node, issues, update }) => {
  const config = node.dmnConfig!;
  const [extraColumns, setExtraColumns] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const columns = outputColumns(config.rules, extraColumns);
  const set = (patch: Partial<DMNConfig>) => update({ ...node, dmnConfig: { ...config, ...patch } });
  const onRulesChange = (next: DMNConfig) => set({ rules: next.rules });
  const policy = HIT_POLICY[config.hitPolicy] ?? HIT_POLICY.FIRST;
  const ruleIssues = issuesAt(issues, 'rules');

  const outputsEditor = (
    <div className="space-y-1.5">
      {columns.map((column) => (
        <ColumnName key={column} name={column}
          onRename={(name) => {
            set({ rules: renameOutputColumn(config.rules, column, name) });
            setExtraColumns((current) => current.map((extra) => (extra === column ? name : extra)));
          }}
          onRemove={() => {
            set({ rules: removeOutputColumn(config.rules, column) });
            setExtraColumns((current) => current.filter((extra) => extra !== column));
          }} />
      ))}
      <button type="button"
        onClick={() => setExtraColumns((current) => [...current, addOutputColumn(columns)])}
        className="flex items-center gap-1 text-[11px] font-semibold text-mineral-teal hover:text-mineral-teal-bright">
        <Plus className="h-3 w-3" /> Add output
      </button>
    </div>
  );

  return (
    <>
      <Section id="decision" title="Decision" issues={[...issuesAt(issues, 'decisionKey'), ...issuesAt(issues, 'hitPolicy')]}>
        <Field label="Decision key" apl="decisionKey" issues={issuesAt(issues, 'decisionKey')}
          help="The stable name the audit trail records for this decision.">
          <input aria-label="Decision key" value={config.decisionKey} className={MONO_INPUT}
            onChange={(e) => set({ decisionKey: e.target.value })} />
        </Field>
        <Field label="When several rules match" apl="hitPolicy" issues={issuesAt(issues, 'hitPolicy')} help={policy.help}>
          <div role="radiogroup" aria-label="Hit policy" className="grid grid-cols-3 gap-1">
            {(Object.keys(HIT_POLICY) as APLHitPolicy[]).map((key) => (
              <button key={key} type="button" role="radio" aria-checked={config.hitPolicy === key}
                onClick={() => set({ hitPolicy: key })}
                className={`rounded-lg border px-1.5 py-1.5 text-[11px] transition-colors duration-[var(--duration-fast)] ${config.hitPolicy === key
                  ? 'border-mineral-teal bg-mineral-teal/10 text-linen' : 'border-hairline bg-charcoal text-sand hover:text-linen'}`}>
                {HIT_POLICY[key].label}
                <span className="block font-mono text-[9px] text-sand-dim">{key}</span>
              </button>
            ))}
          </div>
        </Field>
      </Section>

      <Section id="inputs" title={`Inputs · ${config.inputs.length}`} issues={issuesAt(issues, 'inputs')}
        summary="Conditions see only these names. Each is read from the instance: an expression, or the variable of the same name when empty.">
        <div className="space-y-1.5">
          {config.inputs.map((input, index) => (
            <div key={index} className="group grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-1.5">
              <input aria-label={`Input name ${index + 1}`} value={input.name} placeholder="score" className={MONO_INPUT}
                onChange={(e) => set({ inputs: config.inputs.map((other, at) => (at === index ? { ...other, name: e.target.value.trim() } : other)) })} />
              <input aria-label={`Input expression ${index + 1}`} value={input.expr ?? ''} placeholder={`\${${input.name || 'variable'}}`}
                className={`${MONO_INPUT} text-mineral-teal`}
                onChange={(e) => set({ inputs: config.inputs.map((other, at) => (at === index ? { ...other, expr: e.target.value || undefined } : other)) })} />
              <button type="button" aria-label={`Remove input ${input.name || index + 1}`} title="Remove input"
                onClick={() => set({ inputs: config.inputs.filter((_, at) => at !== index) })}
                className="text-sand opacity-0 transition-opacity hover:text-desert-rose group-hover:opacity-100 focus-visible:opacity-100">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button type="button"
            onClick={() => {
              const names = new Set(config.inputs.map((input) => input.name));
              let name = 'input';
              for (let n = 2; names.has(name); n++) name = `input_${n}`;
              set({ inputs: [...config.inputs, { name }] });
            }}
            className="flex items-center gap-1 text-[11px] font-semibold text-mineral-teal hover:text-mineral-teal-bright">
            <Plus className="h-3 w-3" /> Add input
          </button>
        </div>
      </Section>

      <Section id="outputs" title={`Outputs · ${columns.length}`}
        summary="The variables a matching rule writes to the instance. Values are text, numbers, true/false, or “quoted” text.">
        {outputsEditor}
      </Section>

      <Section id="rules" title={`Rules · ${config.rules.length}`} issues={ruleIssues} summary={policy.help}
        actions={(
          <button type="button" onClick={() => setExpanded(true)} aria-label="Expand the rule table" title="Open the full table"
            className="flex items-center gap-1 rounded-md border border-hairline px-1.5 py-0.5 text-[10px] text-sand hover:bg-mocha-hover hover:text-linen">
            <Maximize2 className="h-3 w-3" /> Expand
          </button>
        )}>
        <RuleList config={config} columns={columns} issues={issues} layout="compact" onChange={onRulesChange} />
      </Section>

      {/* Portalled: the side panel is its own stacking context and would clip a fixed drawer. */}
      {createPortal(
        <Drawer open={expanded} onClose={() => setExpanded(false)} width={Math.min(1100, 260 + columns.length * 150 + 360)}
          title={`${node.title || node.id} · rules`}>
          <div className="space-y-4">
            <p className="text-[11px] text-sand">
              <span className="font-semibold text-linen">{policy.label}.</span> {policy.help} Conditions read the
              inputs {config.inputs.map((input) => input.name).filter(Boolean).join(', ') || '(none declared)'}.
            </p>
            <RuleList config={config} columns={columns} issues={issues} layout="table" onChange={onRulesChange} />
            <div className="border-t border-hairline pt-3">
              <span className="mb-2 block text-[10px] uppercase tracking-wider text-sand">Outputs</span>
              <div className="max-w-sm">{outputsEditor}</div>
            </div>
          </div>
        </Drawer>,
        document.body,
      )}
    </>
  );
};

