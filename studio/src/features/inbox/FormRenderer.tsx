import React from 'react';
import { FormField, FormSchema } from './formSchema';

interface FormRendererProps {
  schema: FormSchema;
  /** Current form values keyed by field.id. */
  values?: Record<string, unknown>;
  /** Called with the full values map whenever a field changes. */
  onChange?: (values: Record<string, unknown>) => void;
  /** Per-field validation messages keyed by field.id. */
  errors?: Record<string, string>;
  readOnly?: boolean;
}

const inputClass =
  'w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-sm text-[#EAE3D9] ' +
  'focus:outline-none focus:border-[#2A9D8F] disabled:opacity-60';

export const FormRenderer: React.FC<FormRendererProps> = ({
  schema,
  values = {},
  onChange,
  errors = {},
  readOnly = false,
}) => {
  const setField = (field: FormField, value: unknown) => {
    if (readOnly) return;
    onChange?.({ ...values, [field.id]: value });
  };

  const renderField = (field: FormField) => {
    const raw = values[field.id];
    const error = errors[field.id];

    const fieldBody = () => {
      switch (field.type) {
        case 'number':
          return (
            <input
              type="number"
              value={raw === undefined || raw === null ? '' : String(raw)}
              onChange={(e) =>
                setField(field, e.target.value === '' ? undefined : Number(e.target.value))
              }
              disabled={readOnly}
              placeholder={field.placeholder || '0'}
              className={inputClass}
            />
          );
        case 'boolean':
          return (
            <label className="flex items-center gap-2 text-sm text-[#EAE3D9] cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(raw)}
                onChange={(e) => setField(field, e.target.checked)}
                disabled={readOnly}
                className="accent-[#2A9D8F] h-4 w-4"
              />
              <span className="text-xs text-[#A89F91]">{field.label || field.id}</span>
            </label>
          );
        case 'select':
          return (
            <select
              value={raw === undefined || raw === null ? '' : String(raw)}
              onChange={(e) => setField(field, e.target.value)}
              disabled={readOnly}
              className={inputClass}
            >
              <option value="">— select —</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          );
        case 'textarea':
          return (
            <textarea
              value={raw === undefined || raw === null ? '' : String(raw)}
              onChange={(e) => setField(field, e.target.value)}
              disabled={readOnly}
              placeholder={field.placeholder || ''}
              rows={3}
              className={`${inputClass} resize-y`}
            />
          );
        case 'date':
          return (
            <input
              type="date"
              value={raw === undefined || raw === null ? '' : String(raw)}
              onChange={(e) => setField(field, e.target.value || undefined)}
              disabled={readOnly}
              className={inputClass}
            />
          );
        default:
          return (
            <input
              type="text"
              value={raw === undefined || raw === null ? '' : String(raw)}
              onChange={(e) => setField(field, e.target.value)}
              disabled={readOnly}
              placeholder={field.placeholder || `Enter ${field.label || 'value'}...`}
              className={inputClass}
            />
          );
      }
    };

    return (
      <div
        key={field.id}
        className="space-y-1.5 rounded-xl border border-[#3A322E] bg-[#25201D] p-3"
      >
        {field.type !== 'boolean' && (
          <label className="flex items-center gap-1 text-xs font-semibold text-[#EAE3D9]">
            {field.label || field.id}
            {field.required && <span className="text-[#E76F51]">*</span>}
            <span className="ml-auto text-[10px] uppercase tracking-wide text-[#A89F91]/60 font-mono">
              {field.type}
            </span>
          </label>
        )}
        {fieldBody()}
        {error && <p className="text-[11px] text-[#E76F51]">{error}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {schema.title && (
        <h3 className="text-base font-semibold text-[#EAE3D9] border-b border-[#3A322E] pb-2">
          {schema.title}
        </h3>
      )}
      {!schema.fields || schema.fields.length === 0 ? (
        <p className="text-sm text-[#A89F91] text-center py-8">This form has no fields.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {schema.fields.map((field) => (
            <React.Fragment key={field.id}>{renderField(field)}</React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
