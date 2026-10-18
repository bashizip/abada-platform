import React from 'react';
import { ListTree, Plus, Trash2, Variable } from 'lucide-react';
import type { AplValidationIssue } from '@/api/apl';
import type { VariableDeclaration } from '@/lib/apl/types.generated';
import { metadataIssuesAt } from '@/lib/apl/issues';
import { NODE_KINDS, kindOf } from '@/features/designer/nodes/nodeCatalog';
import { NodeGlyph } from '@/features/designer/nodes/shapes';
import type { WorkflowFile } from '@/types';
import { Field, FieldIssues, Section } from './InspectorKit';
import { INPUT, MONO_INPUT, TEXTAREA } from './fieldStyles';

type VariableType = NonNullable<VariableDeclaration['type']>;

const VARIABLE_TYPES: VariableType[] = ['string', 'number', 'integer', 'boolean', 'object', 'list', 'any'];

/** Categories Studio offers when a process is created; any other text is kept as written. */
const CATEGORY_SUGGESTIONS = ['finance', 'onboarding', 'claims', 'supply_chain', 'custom'];

/** Metadata fields this editor shows an issue next to; anything else is listed at the top. */
const PLACED_FIELDS = ['name', 'key', 'category', 'owner', 'description', 'variables'];

export interface ProcessEditorProps {
  workflow: WorkflowFile;
  update: (patch: Partial<WorkflowFile>) => void;
  /** Engine issues about no node: the process itself. */
  issues: AplValidationIssue[];
}

/** One declaration with `patch` applied; an unset or default value is left out of the YAML. */
const patchVariable = (variable: VariableDeclaration, patch: Partial<VariableDeclaration>): VariableDeclaration => {
  const next: Record<string, unknown> = { ...variable, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === false || value === '') delete next[key];
  }
  return next as unknown as VariableDeclaration;
};

const VariableRow: React.FC<{
  variable: VariableDeclaration;
  index: number;
  issues: AplValidationIssue[];
  onChange: (variable: VariableDeclaration) => void;
  onRemove: () => void;
}> = ({ variable, index, issues, onChange, onRemove }) => {
  const n = index + 1;
  const set = (patch: Partial<VariableDeclaration>) => onChange(patchVariable(variable, patch));
  return (
    <li className="group space-y-1.5 rounded-lg border border-hairline bg-charcoal/60 p-2">
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto] items-center gap-1.5">
        <input aria-label={`Variable name ${n}`} value={variable.name} placeholder="amount" className={MONO_INPUT}
          onChange={(e) => onChange({ ...variable, name: e.target.value.trim() })} />
        <select aria-label={`Variable type ${n}`} value={variable.type ?? ''} className={INPUT}
          onChange={(e) => set({ type: (e.target.value || undefined) as VariableType | undefined })}>
          <option value="">Not stated (any)</option>
          {VARIABLE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <button type="button" aria-label={`Remove variable ${variable.name || n}`} title="Remove variable" onClick={onRemove}
          className="text-sand opacity-0 transition-opacity hover:text-desert-rose group-hover:opacity-100 focus-visible:opacity-100">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <input aria-label={`Variable description ${n}`} value={variable.description ?? ''} placeholder="What it holds"
        className={INPUT} onChange={(e) => set({ description: e.target.value })} />
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className="flex items-center gap-1.5 text-[10px] text-sand"
          title="Documents the start payload; the engine does not check it yet.">
          <input type="checkbox" aria-label={`Variable ${n} required`} checked={!!variable.required}
            onChange={(e) => set({ required: e.target.checked })} />
          required
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-sand"
          title="Masked in redacted agent evidence: fields with this name and this variable's values.">
          <input type="checkbox" aria-label={`Variable ${n} sensitive`} checked={!!variable.sensitive}
            onChange={(e) => set({ sensitive: e.target.checked })} />
          sensitive
        </label>
      </div>
      <FieldIssues issues={issues} />
    </li>
  );
};

/** Nothing selected: the process itself — its metadata, declared variables and steps. */
export const ProcessEditor: React.FC<ProcessEditorProps> = ({ workflow, update, issues }) => {
  const variables = workflow.variables ?? [];
  // The backend refuses a new key for a saved document: deployed versions are filed under it.
  const keyLocked = !!workflow.documentId;
  const general = issues.filter((issue) => !PLACED_FIELDS.some((field) => metadataIssuesAt([issue], field).length));
  const setVariables = (next: VariableDeclaration[]) => update({ variables: next.length ? next : undefined });

  const counts = new Map<string, number>();
  for (const node of workflow.nodes) counts.set(kindOf(node), (counts.get(kindOf(node)) ?? 0) + 1);
  const present = NODE_KINDS.filter((spec) => counts.has(spec.kind));

  return (
    <div className="space-y-3 p-4">
      <div className="space-y-3">
        <Field label="Name" apl="metadata.name" htmlFor="process-name" issues={metadataIssuesAt(issues, 'name')}
          help={keyLocked ? undefined : 'Required. Without a key, the key is derived from it.'}>
          <input id="process-name" aria-label="Process name" value={workflow.name} className={INPUT}
            onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label="Key" apl="metadata.key" htmlFor="process-key" issues={metadataIssuesAt(issues, 'key')}
          help={keyLocked
            ? 'Fixed once the process is saved: its deployed versions and instances are filed under it.'
            : 'Lowercase letters, digits, - and _, starting with a letter. Empty derives it from the name.'}>
          <input id="process-key" aria-label="Process key" value={workflow.processKey ?? ''} readOnly={keyLocked}
            placeholder={workflow.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}
            className={keyLocked ? `${MONO_INPUT.replace('text-linen', 'text-sand')} cursor-default` : MONO_INPUT}
            onChange={(e) => update({ processKey: e.target.value.trim() || undefined })} />
        </Field>
        <Field label="Description" apl="metadata.description" htmlFor="process-description"
          issues={metadataIssuesAt(issues, 'description')}>
          <textarea id="process-description" aria-label="Process description" rows={2} className={TEXTAREA}
            value={workflow.processDescription ?? ''} placeholder="What this process is for"
            onChange={(e) => update({ processDescription: e.target.value || undefined })} />
        </Field>
        <Field label="Category" apl="metadata.category" htmlFor="process-category" issues={metadataIssuesAt(issues, 'category')}>
          <input id="process-category" aria-label="Category" list="process-category-suggestions" value={workflow.category}
            placeholder="none" className={INPUT} onChange={(e) => update({ category: e.target.value })} />
          <datalist id="process-category-suggestions">
            {CATEGORY_SUGGESTIONS.map((category) => <option key={category} value={category} />)}
          </datalist>
        </Field>
        <Field label="Owner" apl="metadata.owner" htmlFor="process-owner" issues={metadataIssuesAt(issues, 'owner')}>
          <input id="process-owner" aria-label="Owner" value={workflow.owner ?? ''} placeholder="risk-team" className={INPUT}
            onChange={(e) => update({ owner: e.target.value || undefined })} />
        </Field>
        <p className="text-[10px] leading-relaxed text-sand">
          Description, category and owner are for the people reading the process; the engine does not act on them.
        </p>
      </div>

      {general.length > 0 && (
        <div role="status" className="space-y-1 rounded-xl border border-desert-rose/40 bg-desert-rose/10 p-3">
          <span className="text-[11px] font-semibold text-desert-rose">
            {general.length} validation issue{general.length === 1 ? '' : 's'} about the process
          </span>
          <FieldIssues issues={general} />
        </div>
      )}

      <Section id="variables" title={`Variables · ${variables.length}`} icon={<Variable className="h-3.5 w-3.5" />}
        issues={metadataIssuesAt(issues, 'variables')}
        summary="The data the process starts with or its steps write. Declaring any turns on the engine's check: an expression reading a name that is neither declared nor written by an earlier step gets a warning.">
        <FieldIssues issues={issues.filter((issue) => issue.path === '/metadata/variables')} />
        <ul className="space-y-1.5">
          {variables.map((variable, index) => (
            <VariableRow key={index} variable={variable} index={index}
              issues={metadataIssuesAt(issues, 'variables', index)}
              onChange={(next) => setVariables(variables.map((other, at) => (at === index ? next : other)))}
              onRemove={() => setVariables(variables.filter((_, at) => at !== index))} />
          ))}
        </ul>
        <button type="button"
          onClick={() => {
            const names = new Set(variables.map((variable) => variable.name));
            let name = 'variable';
            for (let n = 2; names.has(name); n++) name = `variable_${n}`;
            setVariables([...variables, { name }]);
          }}
          className="flex items-center gap-1 text-[11px] font-semibold text-mineral-teal hover:text-mineral-teal-bright">
          <Plus className="h-3 w-3" /> Add variable
        </button>
      </Section>

      <Section id="steps" title={`Steps · ${workflow.nodes.length}`} icon={<ListTree className="h-3.5 w-3.5" />}
        defaultOpen={false} summary="Select a step on the canvas to edit it; add steps from the palette.">
        <ul className="space-y-1">
          {present.map((spec) => (
            <li key={spec.kind} className="flex items-center gap-3 rounded-lg px-2 py-1 text-xs text-linen">
              <span className="flex w-10 justify-center"><NodeGlyph kind={spec.kind} size={18} /></span>
              <span className="flex-1">{spec.label}</span>
              <span className="font-mono text-sand">{counts.get(spec.kind)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
};
