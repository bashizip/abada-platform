import React, { useEffect, useState } from 'react';
import { FormDensity, FormField, optionsOf } from './formSchema';
import { controlHeight, fromLocalInput, renderMarkdown, toLocalInput } from './formControlHelpers';

/**
 * One input per field type, compact by default: 32 px controls (28 px in a
 * long form), 13 px text, and a maximum width per type so a date or an amount
 * never stretches across the row.
 */
export interface ControlProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  density: FormDensity;
  invalid: boolean;
  describedBy?: string;
  /** Process variables, for `display` fields. */
  variables: Record<string, unknown>;
}

const MAX_WIDTH: Partial<Record<FormField['type'], string>> = {
  number: 'max-w-[11rem]',
  currency: 'max-w-[12.5rem]',
  date: 'max-w-[10rem]',
  datetime: 'max-w-[13.5rem]',
  select: 'max-w-[20rem]',
  string: 'max-w-[24rem]',
  email: 'max-w-[24rem]',
  url: 'max-w-[24rem]',
};


function inputClass(field: FormField, density: FormDensity, invalid: boolean): string {
  return [
    'w-full min-w-0 rounded-md border bg-charcoal px-2.5 text-[13px] text-linen placeholder:text-sand-dim',
    'focus:outline-none focus:border-mineral-teal focus:ring-2 focus:ring-mineral-teal/25 disabled:opacity-60',
    'hover:border-hairline-strong transition-colors',
    controlHeight(density),
    invalid ? 'border-desert-rose' : 'border-hairline',
    MAX_WIDTH[field.type] ?? '',
  ].join(' ');
}

const text = (value: unknown): string => (value === undefined || value === null ? '' : String(value));

const CurrencyInput: React.FC<ControlProps> = ({ field, value, onChange, readOnly, density, invalid, describedBy }) => {
  const [draft, setDraft] = useState(text(value));
  useEffect(() => {
    // Follow outside changes, but keep a draft such as "12." while it is being typed.
    setDraft((current) => (Number(current) === value || (current === '' && value == null) ? current : text(value)));
  }, [value]);
  return (
    <div className={`flex max-w-[12.5rem] rounded-md border bg-charcoal focus-within:border-mineral-teal focus-within:ring-2 focus-within:ring-mineral-teal/25 ${
      controlHeight(density)} ${invalid ? 'border-desert-rose' : 'border-hairline'}`}>
      <span className="flex items-center border-r border-hairline px-2 font-mono text-[11px] text-sand">{field.currency}</span>
      <input
        id={`field-${field.id}`}
        inputMode="decimal"
        value={draft}
        disabled={readOnly}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          const next = event.target.value.replace(/,/g, '').trim();
          setDraft(event.target.value);
          if (next === '') onChange(undefined);
          else onChange(Number.isFinite(Number(next)) ? Number(next) : next);
        }}
        className="min-w-0 flex-1 bg-transparent px-2.5 text-right text-[13px] tabular-nums text-linen focus:outline-none disabled:opacity-60"
      />
    </div>
  );
};

const displayValue = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export const FieldControl: React.FC<ControlProps> = (props) => {
  const { field, value, onChange, readOnly, density, invalid, describedBy, variables } = props;
  const id = `field-${field.id}`;
  const common = { id, disabled: readOnly, 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy };
  const options = optionsOf(field);
  switch (field.type) {
    case 'textarea':
      return (
        <textarea {...common} value={text(value)} rows={density === 'compact' ? 2 : 3} placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass(field, density, invalid)} h-auto resize-y py-1.5 leading-snug`} />
      );
    case 'number':
      return (
        <input {...common} type="number" value={text(value)} placeholder={field.placeholder}
          min={typeof field.min === 'number' ? field.min : undefined} max={typeof field.max === 'number' ? field.max : undefined}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
          className={`${inputClass(field, density, invalid)} tabular-nums`} />
      );
    case 'currency':
      return <CurrencyInput {...props} />;
    case 'select':
      return (
        <select {...common} value={text(value)} onChange={(event) => onChange(event.target.value || undefined)}
          className={`${inputClass(field, density, invalid)} pr-1`}>
          <option value="">Select…</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      );
    case 'radio':
      return (
        <div role="radiogroup" aria-labelledby={`label-${field.id}`} aria-describedby={describedBy}
          className={`inline-flex max-w-full flex-wrap overflow-hidden rounded-md border ${invalid ? 'border-desert-rose' : 'border-hairline'}`}>
          {options.map((option) => {
            const on = value === option.value;
            return (
              <label key={option.value}
                className={`flex cursor-pointer items-center border-r border-hairline px-2.5 text-[12.5px] last:border-r-0 ${
                  density === 'compact' ? 'h-[26px]' : 'h-[30px]'} ${on ? 'bg-mineral-teal/20 text-linen' : 'bg-charcoal text-sand hover:text-linen'}`}>
                <input type="radio" name={id} value={option.value} checked={on} disabled={readOnly}
                  onChange={() => onChange(option.value)} className="sr-only" />
                {option.label}
              </label>
            );
          })}
        </div>
      );
    case 'checkbox-group': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" aria-labelledby={`label-${field.id}`} aria-describedby={describedBy} className="flex flex-wrap gap-x-3.5 gap-y-1 pt-0.5">
          {options.map((option) => (
            <label key={option.value} className="flex min-h-[22px] cursor-pointer items-center gap-1.5 text-[12.5px] text-linen-muted">
              <input type="checkbox" checked={selected.includes(option.value)} disabled={readOnly}
                onChange={(event) => onChange(event.target.checked
                  ? [...selected, option.value] : selected.filter((item) => item !== option.value))}
                className="h-3.5 w-3.5 accent-mineral-teal" />
              {option.label}
            </label>
          ))}
        </div>
      );
    }
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" aria-labelledby={`label-${field.id}`} aria-describedby={describedBy}
          className={`flex max-w-[32rem] flex-wrap items-center gap-1 rounded-md border bg-charcoal p-[3px] ${
            density === 'compact' ? 'min-h-7' : 'min-h-8'} ${invalid ? 'border-desert-rose' : 'border-hairline'}`}>
          {options.map((option) => {
            const on = selected.includes(option.value);
            return (
              <button key={option.value} type="button" aria-pressed={on} disabled={readOnly}
                onClick={() => onChange(on ? selected.filter((item) => item !== option.value) : [...selected, option.value])}
                className={`rounded px-2 text-[11.5px] border transition-colors ${density === 'compact' ? 'h-5' : 'h-[22px]'} ${
                  on ? 'border-mineral-teal/60 bg-mineral-teal/20 text-linen' : 'border-hairline bg-mocha text-sand hover:text-linen'}`}>
                {option.label}
              </button>
            );
          })}
        </div>
      );
    }
    case 'boolean':
      return (
        <label className={`flex cursor-pointer items-center gap-1.5 text-[12.5px] text-linen-muted ${controlHeight(density)}`}>
          <input {...common} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)}
            className="h-3.5 w-3.5 accent-mineral-teal" />
          {field.label || field.id}
          {field.required && <span className="text-desert-rose" aria-hidden="true">*</span>}
        </label>
      );
    case 'date':
      return (
        <input {...common} type="date" value={text(value)}
          min={typeof field.min === 'string' ? field.min : undefined} max={typeof field.max === 'string' ? field.max : undefined}
          onChange={(event) => onChange(event.target.value || undefined)} className={inputClass(field, density, invalid)} />
      );
    case 'datetime':
      return (
        <input {...common} type="datetime-local" value={toLocalInput(value)}
          onChange={(event) => onChange(fromLocalInput(event.target.value))} className={inputClass(field, density, invalid)} />
      );
    case 'display':
      return (
        <div id={id} className={`flex min-w-0 items-center gap-2 rounded-md bg-mocha-deep px-2.5 text-[12.5px] text-linen ${
          density === 'compact' ? 'min-h-7' : 'min-h-8'}`}>
          <span className="truncate">{displayValue(field.variable ? variables[field.variable] : undefined)}</span>
        </div>
      );
    case 'markdown':
      return (
        <div className="space-y-1.5 rounded-md border border-mineral-teal/25 bg-mineral-teal/5 px-2.5 py-2 text-[12px] leading-relaxed text-sand">
          {renderMarkdown(field.text ?? '')}
        </div>
      );
    case 'file':
      return <p className="text-[12px] text-sand-dim">File upload arrives in a later release.</p>;
    default:
      return (
        <input {...common} type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}
          value={text(value)} placeholder={field.placeholder}
          maxLength={field.maxLength}
          onChange={(event) => onChange(event.target.value)} className={inputClass(field, density, invalid)} />
      );
  }
};
