import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  FormDensity, FormField, FormSchema, FormSection, MOBILE_WIDTH, autoColumns, cellField, cellSpan, densityFor,
  isInput, validateForm, visibilityScope,
} from './formSchema';
import { isVisible } from './visibility';
import { FieldControl } from './FormControls';

interface FormRendererProps {
  schema: FormSchema;
  /** Current form values keyed by field.id. */
  values?: Record<string, unknown>;
  /** Called with the full values map whenever a field changes. */
  onChange?: (values: Record<string, unknown>) => void;
  /** Per-field validation messages keyed by field.id. */
  errors?: Record<string, string>;
  /** Called with the current step's messages when Next finds a problem. */
  onErrors?: (errors: Record<string, string>) => void;
  readOnly?: boolean;
  /** Process variables: shown by display fields and read by `visible_when`. */
  variables?: Record<string, unknown>;
  /** Container width in px; measured when omitted (the preview and tests set it). */
  width?: number;
  /** Shows the density badge (designer preview). */
  showDensity?: boolean;
}

interface Placed {
  field: FormField;
  span: number;
}

interface SectionView {
  section: FormSection;
  rows: Placed[][];
  inputs: number;
}

const GAP: Record<FormDensity, string> = { comfortable: 'gap-y-4', standard: 'gap-y-3', compact: 'gap-y-2' };
const SECTION_GAP: Record<FormDensity, string> = { comfortable: 'gap-6', standard: 'gap-5', compact: 'gap-4' };
const WIDE_TYPES: FormField['type'][] = ['textarea', 'markdown', 'checkbox-group'];

/** Width of the element, following resizes; `fixed` wins when given. */
function useWidth(ref: React.RefObject<HTMLElement | null>, fixed?: number): number {
  const [width, setWidth] = useState(fixed ?? 1024);
  useLayoutEffect(() => {
    if (fixed !== undefined) {
      setWidth(fixed);
      return;
    }
    const element = ref.current;
    if (!element) return;
    if (element.clientWidth > 0) setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, fixed]);
  return width;
}

function sectionsOf(schema: FormSchema, visible: (field: FormField) => boolean): SectionView[] {
  const byId = new Map(schema.fields.map((field) => [field.id, field]));
  if (!schema.layout?.sections?.length) {
    const fields = schema.fields.filter(visible);
    return [{
      section: { id: '__all', rows: [] },
      rows: [fields.map((field) => ({ field, span: WIDE_TYPES.includes(field.type) ? 0 : 1 }))],
      inputs: fields.filter(isInput).length,
    }];
  }
  return schema.layout.sections.map((section) => {
    let inputs = 0;
    const rows = (section.rows ?? []).map((row) => row.flatMap((cell) => {
      const field = byId.get(cellField(cell));
      if (!field) return [];
      if (isInput(field)) inputs++;
      return visible(field) ? [{ field, span: cellSpan(cell) }] : [];
    })).filter((row) => row.length > 0);
    return { section, rows, inputs };
  });
}

export const FormRenderer: React.FC<FormRendererProps> = ({
  schema,
  values = {},
  onChange,
  errors = {},
  onErrors,
  readOnly = false,
  variables = {},
  width: fixedWidth,
  showDensity = false,
}) => {
  const root = useRef<HTMLDivElement>(null);
  const width = useWidth(root, fixedWidth);
  const mobile = width < MOBILE_WIDTH;
  const [step, setStep] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const scope = visibilityScope(values, variables);
  const visible = (field: FormField) => isVisible(field.visible_when, scope);
  const visibleInputs = (schema.fields ?? []).filter((field) => isInput(field) && visible(field)).length;
  const density = densityFor(visibleInputs);
  const flat = !schema.layout?.sections?.length;
  const steps = !flat ? schema.layout?.steps : undefined;
  const allSections = sectionsOf(schema, visible);
  const current = steps ? Math.min(step, steps.length - 1) : 0;
  const shown = steps ? allSections.filter((view) => steps[current].sections.includes(view.section.id)) : allSections;

  const stepOfField = useMemo(() => {
    const map = new Map<string, number>();
    steps?.forEach((st, index) => schema.layout?.sections
      .filter((section) => st.sections.includes(section.id))
      .forEach((section) => section.rows.forEach((row) => row.forEach((cell) => map.set(cellField(cell), index)))));
    return map;
  }, [steps, schema.layout]);

  // A submit that finds problems on another step brings that step forward.
  const errorKey = Object.keys(errors).join('|');
  useEffect(() => {
    if (!steps || !errorKey) return;
    const steppedErrors = errorKey.split('|').map((id) => stepOfField.get(id)).filter((index): index is number => index !== undefined);
    if (steppedErrors.length && !steppedErrors.includes(current)) setStep(Math.min(...steppedErrors));
  }, [errorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (field: FormField, value: unknown) => {
    if (readOnly) return;
    onChange?.({ ...values, [field.id]: value });
  };

  const goNext = () => {
    if (!steps) return;
    const ids = Array.from(stepOfField.entries()).filter(([, index]) => index === current).map(([id]) => id);
    const stepErrors = validateForm(schema, values, { variables, onlyIds: ids });
    onErrors?.(stepErrors);
    if (Object.keys(stepErrors).length === 0) setStep(current + 1);
  };

  const columns = flat ? autoColumns(density, width) : mobile ? 1 : 4;

  const renderField = ({ field, span }: Placed) => {
    const error = errors[field.id];
    const describedBy = error ? `error-${field.id}` : field.help ? `help-${field.id}` : undefined;
    const gridColumn = columns === 1 || span === 0 ? '1 / -1' : `span ${Math.min(span, columns)}`;
    const labelled = field.type !== 'boolean' && field.type !== 'markdown';
    return (
      <div key={field.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-1" style={{ gridColumn }} data-field={field.id}>
        {labelled ? (
          <label id={`label-${field.id}`} htmlFor={`field-${field.id}`}
            className="flex items-baseline gap-1 text-[12px] font-semibold leading-tight text-linen-muted">
            {field.label || field.id}
            {field.required && <span className="text-desert-rose" aria-label="required">*</span>}
          </label>
        ) : field.type === 'boolean' && !flat && !mobile ? (
          <span className="text-[12px] leading-tight" aria-hidden="true">&nbsp;</span>
        ) : null}
        <FieldControl field={field} value={values[field.id]} onChange={(value) => setField(field, value)}
          readOnly={readOnly} density={density} invalid={!!error} describedBy={describedBy} variables={variables} />
        {error ? (
          <p id={`error-${field.id}`} role="alert" className="text-[11px] leading-snug text-desert-rose">{error}</p>
        ) : field.help ? (
          <p id={`help-${field.id}`} className="text-[11px] leading-snug text-sand-dim">{field.help}</p>
        ) : null}
      </div>
    );
  };

  const gridStyle = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  return (
    <div ref={root} className={`grid min-w-0 grid-cols-[minmax(0,1fr)] ${SECTION_GAP[density]}`} data-density={density} data-columns={columns}
      data-layout={mobile ? 'mobile' : 'desktop'}>
      {schema.title && (
        <h3 className="border-b border-hairline pb-2 text-[14px] font-semibold text-linen">{schema.title}</h3>
      )}
      {showDensity && (
        <p className="font-mono text-[10px] text-sand-dim">{visibleInputs} visible fields · {density}{flat ? ' · auto layout' : ''}</p>
      )}
      {steps && steps.length > 1 && (
        <div className="grid gap-1.5" aria-label={`Step ${current + 1} of ${steps.length}`}>
          <div className="grid grid-flow-col auto-cols-fr gap-1">
            {steps.map((st, index) => (
              <i key={st.title + index} className={`h-[3px] rounded-full ${index <= current ? 'bg-mineral-teal' : 'bg-hairline'}`} />
            ))}
          </div>
          <ol className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-[11px] text-sand-dim">
            {steps.map((st, index) => (
              <li key={st.title + index} className={index === current ? 'font-semibold text-linen' : ''}
                aria-current={index === current ? 'step' : undefined}>
                {index + 1}. {st.title}
              </li>
            ))}
          </ol>
        </div>
      )}
      {(!schema.fields || schema.fields.length === 0) ? (
        <p className="py-8 text-center text-[13px] text-sand">This form has no fields.</p>
      ) : shown.map(({ section, rows, inputs }) => {
        const closed = section.collapsible && collapsed[section.id];
        return (
          <section key={section.id} className={`grid min-w-0 grid-cols-[minmax(0,1fr)] ${GAP[density]}`} aria-labelledby={section.title ? `section-${section.id}` : undefined}>
            {section.title && (
              <header className="flex items-baseline gap-2 border-b border-hairline pb-1.5">
                <h4 id={`section-${section.id}`} className="text-[13px] font-semibold text-linen">{section.title}</h4>
                {section.description && <p className="min-w-0 truncate text-[11.5px] text-sand">{section.description}</p>}
                <span className="ml-auto shrink-0 text-[11px] text-sand-dim">{inputs} field{inputs === 1 ? '' : 's'}</span>
                {section.collapsible && (
                  <button type="button" onClick={() => setCollapsed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                    aria-expanded={!closed} className="flex items-center gap-0.5 text-[11px] text-sand hover:text-linen">
                    {closed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {closed ? 'Show' : 'Hide'}
                  </button>
                )}
              </header>
            )}
            {!closed && rows.map((row, index) => (
              <div key={index} className={`grid gap-x-3 ${GAP[density]}`} style={gridStyle}>
                {row.map(renderField)}
              </div>
            ))}
          </section>
        );
      })}
      {steps && steps.length > 1 && (
        <div className="flex items-center gap-2">
          {current > 0 && (
            <button type="button" onClick={() => setStep(current - 1)}
              className="h-7 rounded-md border border-hairline bg-mocha px-3 text-[12px] font-medium text-linen hover:bg-mocha-hover">
              Back
            </button>
          )}
          {current < steps.length - 1 && (
            <button type="button" onClick={goNext}
              className="h-7 rounded-md border border-mineral-teal/50 bg-mineral-teal/15 px-3 text-[12px] font-semibold text-linen hover:bg-mineral-teal/25">
              Next: {steps[current + 1].title}
            </button>
          )}
          <span className="ml-auto text-[11px] text-sand-dim">Step {current + 1} of {steps.length}</span>
        </div>
      )}
    </div>
  );
};
