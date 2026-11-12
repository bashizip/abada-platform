import React from 'react';
import { Settings2, Trash2 } from 'lucide-react';
import {
  FormField, FormSchema, FormSection, GRID_COLUMNS, isChoice, isInput, isMulti, isText, optionsOf, patternProblem,
} from '@/features/inbox/formSchema';
import { visibilityProblem } from '@/features/inbox/visibility';
import { locate, maxSpan, stepStarts } from './formModel';

export type Selection = { kind: 'field'; id: string } | { kind: 'section'; id: string } | null;

interface FormPropertiesProps {
  schema: FormSchema;
  selection: Selection;
  onField: (id: string, patch: Partial<FormField>, coalesceKey?: string) => void;
  onSpan: (id: string, span: number) => void;
  onSection: (id: string, patch: Partial<FormSection>, coalesceKey?: string) => void;
  onStepStart: (sectionId: string, starts: boolean) => void;
  onRemoveSection: (id: string) => void;
}

const inputClass = 'h-7 w-full rounded-md border border-hairline bg-charcoal px-2 text-[12px] text-linen ' +
  'focus:outline-none focus:border-mineral-teal';

const Prop: React.FC<{ label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }> = ({
  label, htmlFor, hint, children,
}) => (
  <div className="grid gap-1">
    <label htmlFor={htmlFor} className="text-[11.5px] font-medium text-sand">{label}</label>
    {children}
    {hint && <div className="text-[10.5px] leading-snug text-sand-dim">{hint}</div>}
  </div>
);

/** The variable name: a draft while typing, applied once it is valid and unused. */
const VariableInput: React.FC<{ schema: FormSchema; field: FormField; onRename: (id: string) => void }> = ({ schema, field, onRename }) => {
  const [draft, setDraft] = React.useState(field.id);
  React.useEffect(() => setDraft(field.id), [field.id]);
  const taken = draft !== field.id && schema.fields.some((other) => other.id === draft);
  const invalid = !/^[A-Za-z_][A-Za-z0-9_]*$/.test(draft) || taken;
  return (
    <Prop label="Variable" htmlFor="prop-id"
      hint={taken ? <span className="text-desert-rose">Another field already writes '{draft}'.</span>
        : invalid ? <span className="text-desert-rose">Letters, digits and _, not starting with a digit.</span>
          : 'The process variable this field writes.'}>
      <input id="prop-id" className={`${inputClass} font-mono ${invalid ? 'border-desert-rose' : ''}`} value={draft}
        onChange={(event) => {
          const next = event.target.value.replace(/[^A-Za-z0-9_]/g, '');
          setDraft(next);
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(next) && !schema.fields.some((other) => other.id === next)) onRename(next);
        }} />
    </Prop>
  );
};

const numberOrUndefined = (value: string): number | undefined => (value === '' ? undefined : Number(value));

export const FormProperties: React.FC<FormPropertiesProps> = ({
  schema, selection, onField, onSpan, onSection, onStepStart, onRemoveSection,
}) => {
  if (!selection) {
    return <p className="text-[12px] leading-relaxed text-sand">Select a field on the canvas to edit it, or a section title to edit the section.</p>;
  }

  if (selection.kind === 'section') {
    const index = schema.layout?.sections.findIndex((section) => section.id === selection.id) ?? -1;
    const section = schema.layout?.sections[index];
    if (!section) return null;
    const starts = stepStarts(schema);
    const empty = section.rows.every((row) => row.length === 0);
    return (
      <div className="grid gap-3">
        <h4 className="flex items-center gap-2 text-[12.5px] font-semibold text-linen">
          <Settings2 className="h-3.5 w-3.5 text-mineral-teal" /> Section <span className="font-mono text-[10.5px] font-normal text-sand">{section.id}</span>
        </h4>
        <Prop label="Title" htmlFor="prop-section-title">
          <input id="prop-section-title" className={inputClass} value={section.title ?? ''}
            onChange={(event) => onSection(section.id, { title: event.target.value }, `section-title-${section.id}`)} />
        </Prop>
        <Prop label="Description" htmlFor="prop-section-description">
          <textarea id="prop-section-description" rows={2} className={`${inputClass} h-auto py-1.5`} value={section.description ?? ''}
            onChange={(event) => onSection(section.id, { description: event.target.value || undefined }, `section-description-${section.id}`)} />
        </Prop>
        <label className="flex items-center gap-2 text-[12px] text-linen">
          <input type="checkbox" className="h-3.5 w-3.5 accent-mineral-teal" checked={!!section.collapsible}
            onChange={(event) => onSection(section.id, { collapsible: event.target.checked || undefined })} />
          The person filling it can collapse it
        </label>
        {index > 0 && (
          <label className="flex items-center gap-2 text-[12px] text-linen">
            <input type="checkbox" className="h-3.5 w-3.5 accent-mineral-teal" checked={starts.includes(section.id)}
              onChange={(event) => onStepStart(section.id, event.target.checked)} />
            Starts a new wizard step
          </label>
        )}
        <p className="text-[10.5px] leading-snug text-sand-dim">
          Steps split a long form; Next checks the step's own fields, and the engine checks the whole form on completion.
        </p>
        {empty && (schema.layout?.sections.length ?? 0) > 1 && (
          <button type="button" onClick={() => onRemoveSection(section.id)}
            className="flex h-7 w-max items-center gap-1.5 rounded-md border border-desert-rose/40 px-2.5 text-[12px] text-desert-rose hover:bg-desert-rose/10">
            <Trash2 className="h-3.5 w-3.5" /> Remove empty section
          </button>
        )}
      </div>
    );
  }

  const field = schema.fields.find((candidate) => candidate.id === selection.id);
  if (!field) return null;
  const at = locate(schema, field.id);
  const span = at ? Math.max(1, Math.min(GRID_COLUMNS, (() => {
    const cell = schema.layout!.sections[at.section].rows[at.row][at.cell];
    return typeof cell === 'string' ? 1 : cell.span ?? 1;
  })())) : 1;
  const widest = maxSpan(schema, field.id);
  const set = (patch: Partial<FormField>, key?: string) => onField(field.id, patch, key ? `${key}-${field.id}` : undefined);
  const visibility = field.visible_when ? visibilityProblem(field.visible_when) : null;
  const pattern = field.pattern ? patternProblem(field.pattern) : null;
  const dateLike = field.type === 'date' || field.type === 'datetime';

  return (
    <div className="grid gap-3">
      <h4 className="flex items-center gap-2 text-[12.5px] font-semibold text-linen">
        <Settings2 className="h-3.5 w-3.5 text-mineral-teal" />
        <span className="truncate">{field.label || field.id}</span>
        <span className="ml-auto font-mono text-[10.5px] font-normal text-sand">{field.type}</span>
      </h4>
      <Prop label="Label" htmlFor="prop-label">
        <input id="prop-label" className={inputClass} value={field.label} onChange={(event) => set({ label: event.target.value }, 'label')} />
      </Prop>
      {isInput(field) && (
        <VariableInput schema={schema} field={field} onRename={(id) => set({ id })} />
      )}
      {field.type === 'display' && (
        <Prop label="Shows variable" htmlFor="prop-variable">
          <input id="prop-variable" className={`${inputClass} font-mono`} value={field.variable ?? ''}
            onChange={(event) => set({ variable: event.target.value.replace(/[^A-Za-z0-9_]/g, '') }, 'variable')} />
        </Prop>
      )}
      {field.type === 'markdown' && (
        <Prop label="Text" htmlFor="prop-text" hint="**Bold**, *italics*, - lists and [links](https://…). No HTML.">
          <textarea id="prop-text" rows={4} className={`${inputClass} h-auto py-1.5`} value={field.text ?? ''}
            onChange={(event) => set({ text: event.target.value }, 'text')} />
        </Prop>
      )}
      <Prop label="Width in its row" hint={`${span}/4. On mobile every field takes the full width.`}>
        <div className="inline-flex gap-0.5" role="group" aria-label="Width">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" aria-pressed={n === span} disabled={n > widest}
              onClick={() => onSpan(field.id, n)}
              className={`h-6 w-9 rounded border text-[11px] disabled:opacity-30 ${n === span
                ? 'border-mineral-teal bg-mineral-teal/15 text-linen' : 'border-hairline bg-charcoal text-sand hover:text-linen'}`}>
              {n}/4
            </button>
          ))}
        </div>
      </Prop>
      {isInput(field) && (
        <>
          <label className="flex items-center gap-2 text-[12px] text-linen">
            <input type="checkbox" className="h-3.5 w-3.5 accent-mineral-teal" checked={!!field.required}
              onChange={(event) => set({ required: event.target.checked || undefined })} />
            Required{field.type === 'boolean' ? ' (must be checked)' : ''}
          </label>
          {field.type !== 'boolean' && (
            <Prop label="Help text" htmlFor="prop-help">
              <input id="prop-help" className={inputClass} value={field.help ?? ''} onChange={(event) => set({ help: event.target.value }, 'help')} />
            </Prop>
          )}
          {(isText(field) || field.type === 'number') && (
            <Prop label="Placeholder" htmlFor="prop-placeholder">
              <input id="prop-placeholder" className={inputClass} value={field.placeholder ?? ''}
                onChange={(event) => set({ placeholder: event.target.value }, 'placeholder')} />
            </Prop>
          )}
          <div className="border-t border-hairline pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-moss">
            Rules · checked by the engine
          </div>
          {isText(field) && (
            <div className="grid grid-cols-2 gap-2">
              <Prop label="Min length" htmlFor="prop-minlength">
                <input id="prop-minlength" type="number" min={0} className={inputClass} value={field.minLength ?? ''}
                  onChange={(event) => set({ minLength: numberOrUndefined(event.target.value) }, 'minLength')} />
              </Prop>
              <Prop label="Max length" htmlFor="prop-maxlength">
                <input id="prop-maxlength" type="number" min={0} className={inputClass} value={field.maxLength ?? ''}
                  onChange={(event) => set({ maxLength: numberOrUndefined(event.target.value) }, 'maxLength')} />
              </Prop>
            </div>
          )}
          {(field.type === 'string' || field.type === 'textarea') && (
            <Prop label="Pattern" htmlFor="prop-pattern"
              hint={pattern ? <span className="text-desert-rose">{pattern}</span> : 'The whole value must match. Portable regex: no look-around or back-references.'}>
              <input id="prop-pattern" className={`${inputClass} font-mono ${pattern ? 'border-desert-rose' : ''}`} value={field.pattern ?? ''}
                onChange={(event) => set({ pattern: event.target.value }, 'pattern')} />
            </Prop>
          )}
          {(field.type === 'number' || field.type === 'currency' || isMulti(field) || dateLike) && (
            <div className="grid grid-cols-2 gap-2">
              <Prop label={isMulti(field) ? 'Pick at least' : dateLike ? 'Earliest' : 'Min'} htmlFor="prop-min">
                <input id="prop-min" type={dateLike ? 'text' : 'number'} placeholder={field.type === 'date' ? 'YYYY-MM-DD' : undefined}
                  className={inputClass} value={field.min ?? ''}
                  onChange={(event) => set({ min: dateLike ? event.target.value || undefined : numberOrUndefined(event.target.value) }, 'min')} />
              </Prop>
              <Prop label={isMulti(field) ? 'Pick at most' : dateLike ? 'Latest' : 'Max'} htmlFor="prop-max">
                <input id="prop-max" type={dateLike ? 'text' : 'number'} placeholder={field.type === 'date' ? 'YYYY-MM-DD' : undefined}
                  className={inputClass} value={field.max ?? ''}
                  onChange={(event) => set({ max: dateLike ? event.target.value || undefined : numberOrUndefined(event.target.value) }, 'max')} />
              </Prop>
            </div>
          )}
          {field.type === 'file' && (
            <>
              <Prop label="Accepted files" htmlFor="prop-accept"
                hint="Extensions (.pdf) or types (image/*), comma separated; empty accepts any. The engine reads each file's bytes to check it.">
                <input id="prop-accept" className={`${inputClass} font-mono`} placeholder=".pdf, image/*"
                  value={(field.accept ?? []).join(', ')}
                  onChange={(event) => {
                    const accept = event.target.value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
                    set({ accept: accept.length ? accept : undefined }, 'accept');
                  }} />
              </Prop>
              <div className="grid grid-cols-2 gap-2">
                <Prop label="Largest file (MB)" htmlFor="prop-maxsize" hint="Within the engine's cap (10 MB unless configured).">
                  <input id="prop-maxsize" type="number" min={0.1} step={0.1} className={inputClass}
                    value={field.maxSize ? Math.round(field.maxSize / 104857.6) / 10 : ''}
                    onChange={(event) => {
                      const mb = numberOrUndefined(event.target.value);
                      set({ maxSize: mb && mb > 0 ? Math.round(mb * 1024 * 1024) : undefined }, 'maxSize');
                    }} />
                </Prop>
                <label className="mt-5 flex items-center gap-2 text-[12px] text-linen">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-mineral-teal" checked={!!field.multiple}
                    onChange={(event) => set(event.target.checked ? { multiple: true } : { multiple: undefined, min: undefined, max: undefined })} />
                  Several files
                </label>
              </div>
              {field.multiple && (
                <div className="grid grid-cols-2 gap-2">
                  <Prop label="At least" htmlFor="prop-min">
                    <input id="prop-min" type="number" min={0} className={inputClass} value={field.min ?? ''}
                      onChange={(event) => set({ min: numberOrUndefined(event.target.value) }, 'min')} />
                  </Prop>
                  <Prop label="At most" htmlFor="prop-max">
                    <input id="prop-max" type="number" min={1} className={inputClass} value={field.max ?? ''}
                      onChange={(event) => set({ max: numberOrUndefined(event.target.value) }, 'max')} />
                  </Prop>
                </div>
              )}
            </>
          )}
          {field.type === 'currency' && (
            <Prop label="Currency (ISO 4217)" htmlFor="prop-currency" hint="Fixed for this field. EUR allows 2 decimals, JPY none.">
              <input id="prop-currency" maxLength={3} className={`${inputClass} font-mono uppercase`} value={field.currency ?? ''}
                onChange={(event) => set({ currency: event.target.value.toUpperCase() }, 'currency')} />
            </Prop>
          )}
          {isChoice(field) && (
            <Prop label="Options, one per line" htmlFor="prop-options" hint="The engine refuses a value that is not one of these.">
              <textarea id="prop-options" rows={4} className={`${inputClass} h-auto py-1.5`}
                value={optionsOf(field).map((option) => option.label === option.value ? option.value : `${option.value} | ${option.label}`).join('\n')}
                onChange={(event) => set({
                  options: event.target.value.split('\n').map((line) => {
                    const [value, label] = line.split('|').map((part) => part.trim());
                    return label ? { value, label } : value;
                  }).filter((option) => (typeof option === 'string' ? option !== '' : option.value !== '')),
                }, 'options')} />
            </Prop>
          )}
        </>
      )}
      <div className="border-t border-hairline pt-3">
        <Prop label="Show only when" htmlFor="prop-visible"
          hint={visibility ? <span className="text-desert-rose">{visibility}</span>
            : field.visible_when ? <span className="text-sage-green">Valid. Checked in the browser and again by the engine.</span>
              : 'e.g. vat_registered == true. A hidden field is never required, and its value is discarded.'}>
          <input id="prop-visible" className={`${inputClass} font-mono ${visibility ? 'border-desert-rose' : ''}`}
            placeholder="always shown" value={field.visible_when ?? ''}
            onChange={(event) => set({ visible_when: event.target.value }, 'visible')} />
        </Prop>
      </div>
    </div>
  );
};
