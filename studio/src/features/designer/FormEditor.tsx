import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, m } from 'motion/react';
import {
  AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, LayoutTemplate, Monitor, Plus, Redo2, Save, Smartphone,
  Trash2, Undo2, X,
} from 'lucide-react';
import {
  FormField, FormFieldType, FormSchema, FormSection, cellField, cellSpan, formProblems, isInput,
} from '@/features/inbox/formSchema';
import { FormRenderer } from '@/features/inbox/FormRenderer';
import { renderMarkdown } from '@/features/inbox/formControlHelpers';
import { backdrop, modal, useMotionVariants } from '@/lib/motion';
import { isEditableTarget, undoShortcut } from '@/lib/history/shortcuts';
import {
  addField, addSection, maxSpan, moveField, nudgeField, removeField, removeSection, setSpan, setStepStarts, shiftInRow,
  stepStarts, updateField, updateSection, withLayout,
} from './form/formModel';
import { useFormHistory } from './form/useFormHistory';
import { FormProperties, Selection } from './form/FormProperties';

export type { FormFieldType, FormField, FormSchema } from '@/features/inbox/formSchema';

interface FormEditorProps {
  initialSchema: FormSchema;
  onSave: (schema: FormSchema) => void;
  onClose: () => void;
  saving?: boolean;
  /** Where the form lives, shown under the title (e.g. forms/loan-approval.json). */
  location?: string;
}

interface PaletteItem {
  type: FormFieldType;
  label: string;
  glyph: string;
  disabled?: string;
}

const PALETTE: { group: string; items: PaletteItem[] }[] = [
  { group: 'Input', items: [
    { type: 'string', label: 'Text', glyph: 'Aa' }, { type: 'textarea', label: 'Long text', glyph: '¶' },
    { type: 'number', label: 'Number', glyph: '#' }, { type: 'currency', label: 'Currency', glyph: '€' },
    { type: 'email', label: 'Email', glyph: '@' }, { type: 'url', label: 'URL', glyph: '⧉' },
  ] },
  { group: 'Choice', items: [
    { type: 'select', label: 'Select', glyph: '▾' }, { type: 'radio', label: 'Radio', glyph: '◉' },
    { type: 'multiselect', label: 'Multi-select', glyph: '▤' }, { type: 'checkbox-group', label: 'Checkboxes', glyph: '☑' },
    { type: 'boolean', label: 'Yes / no', glyph: '◐' },
  ] },
  { group: 'Date & time', items: [
    { type: 'date', label: 'Date', glyph: '▦' }, { type: 'datetime', label: 'Date & time', glyph: '◷' },
  ] },
  { group: 'Content', items: [
    { type: 'display', label: 'Show variable', glyph: '⎘' }, { type: 'markdown', label: 'Help text', glyph: 'M↓' },
    { type: 'file', label: 'File', glyph: '⇪' },
  ] },
];

const DRAG_NEW = 'application/x-abada-form-new';
const DRAG_MOVE = 'application/x-abada-form-move';

const sampleValue = (field: FormField): unknown => {
  switch (field.type) {
    case 'boolean': return false;
    default: return undefined;
  }
};

const Ghost: React.FC<{ field: FormField }> = ({ field }) => {
  if (field.type === 'markdown') {
    return <div className="mt-1 space-y-1 text-[11px] leading-snug text-sand">{renderMarkdown(field.text ?? '')}</div>;
  }
  if (field.type === 'display') {
    return <div className="mt-1 truncate rounded bg-mocha-deep px-1.5 py-0.5 font-mono text-[10px] text-sand">{`\${${field.variable ?? ''}}`}</div>;
  }
  const tall = field.type === 'textarea' || field.type === 'checkbox-group';
  return <div className={`mt-1 rounded border border-hairline bg-mocha-deep ${tall ? 'h-9' : 'h-5'}`} />;
};

/**
 * The form designer: a near-full-screen panel with the palette on the left,
 * the form canvas (sections, rows of 1-4 fields on a 4-column grid) in the
 * middle and the selected field's properties on the right. Preview renders the
 * real task form at desktop or phone width. Esc closes, with a guard when
 * there are unsaved changes.
 */
export const FormEditor: React.FC<FormEditorProps> = ({ initialSchema, onSave, onClose, saving = false, location }) => {
  const initial = useMemo(() => withLayout(initialSchema ?? { title: 'New form', fields: [] }), [initialSchema]);
  const history = useFormHistory(initial);
  const { schema } = history;
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const [selection, setSelection] = useState<Selection>(initial.fields[0] ? { kind: 'field', id: initial.fields[0].id } : null);
  const [mode, setMode] = useState<'design' | 'preview'>('design');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [guard, setGuard] = useState(false);
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({});
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const panelVariants = useMotionVariants(modal);
  const backdropVariants = useMotionVariants(backdrop);

  const dirty = JSON.stringify(schema) !== savedJson;
  const problems = useMemo(() => formProblems(schema), [schema]);
  const sections = schema.layout?.sections ?? [];
  const steps = schema.layout?.steps;
  const starts = stepStarts(schema);
  const inputs = schema.fields.filter(isInput).length;

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 2600);
  };

  const requestClose = useCallback(() => {
    if (dirty) setGuard(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (guard) keepEditing.current?.focus();
  }, [guard]);

  const selectedField = selection?.kind === 'field' ? schema.fields.find((field) => field.id === selection.id) : undefined;

  const act = useCallback((action: 'narrow' | 'widen' | 'up' | 'down' | 'left' | 'right' | 'remove') => {
    if (selection?.kind !== 'field') return;
    const id = selection.id;
    const current = schema.layout?.sections.flatMap((section) => section.rows.flat()).find((cell) => cellField(cell) === id);
    const span = current ? cellSpan(current) : 1;
    switch (action) {
      case 'narrow': if (span > 1) history.set(setSpan(schema, id, span - 1)); break;
      case 'widen':
        if (maxSpan(schema, id) > span) history.set(setSpan(schema, id, span + 1));
        else flash('The row is full: make another field in it narrower first.');
        break;
      case 'up': case 'down': history.set(nudgeField(schema, id, action)); break;
      case 'left': history.set(shiftInRow(schema, id, -1)); break;
      case 'right': history.set(shiftInRow(schema, id, 1)); break;
      case 'remove': {
        const next = removeField(schema, id);
        history.set(next);
        setSelection(null);
        break;
      }
    }
  }, [selection, schema, history]);

  // Keyboard: Esc closes (guarded), undo/redo outside text fields, arrows on the selected field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (guard) setGuard(false);
        else requestClose();
        return;
      }
      const editable = isEditableTarget(event.target);
      const shortcut = undoShortcut(event);
      if (shortcut && !editable) {
        event.preventDefault();
        if (shortcut === 'undo') history.undo(); else history.redo();
        return;
      }
      const onCell = event.target instanceof HTMLElement && event.target.closest('[data-form-cell]');
      if (editable || !onCell || mode !== 'design') return;
      const map: Record<string, Parameters<typeof act>[0]> = {
        ArrowLeft: event.altKey ? 'left' : 'narrow', ArrowRight: event.altKey ? 'right' : 'widen',
        ArrowUp: 'up', ArrowDown: 'down', Delete: 'remove', Backspace: 'remove',
      };
      const action = map[event.key];
      if (action) {
        event.preventDefault();
        act(action);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [guard, requestClose, history, act, mode]);

  // Keep focus on the selected cell after a keyboard move.
  useEffect(() => {
    if (selection?.kind !== 'field') return;
    const cell = document.querySelector<HTMLElement>(`[data-form-cell="${selection.id}"]`);
    if (cell && document.activeElement?.closest('[data-form-cell]')) cell.focus();
  }, [schema, selection]);

  const add = (type: FormFieldType, section?: number, row?: number) => {
    const item = PALETTE.flatMap((group) => group.items).find((candidate) => candidate.type === type);
    if (item?.disabled) {
      flash(item.disabled);
      return;
    }
    const targetSection = section ?? (selection
      ? Math.max(0, sections.findIndex((candidate) => selection.kind === 'section'
        ? candidate.id === selection.id
        : candidate.rows.some((cells) => cells.some((cell) => cellField(cell) === selection.id))))
      : sections.length - 1);
    const result = addField(schema, type, targetSection, row ?? -1);
    history.set(result.schema);
    setSelection({ kind: 'field', id: result.id });
  };

  const onDrop = (event: React.DragEvent, section: number, row: number) => {
    event.preventDefault();
    setDropTarget(null);
    const type = event.dataTransfer.getData(DRAG_NEW) as FormFieldType;
    if (type) {
      add(type, section, row);
      return;
    }
    const id = event.dataTransfer.getData(DRAG_MOVE);
    if (!id) return;
    const next = moveField(schema, id, section, row);
    if (next === schema && row >= 0) flash('That row is full.');
    history.set(next);
    setSelection({ kind: 'field', id });
  };

  const dropProps = (key: string, section: number, row: number) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_NEW) && !event.dataTransfer.types.includes(DRAG_MOVE)) return;
      event.preventDefault();
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
    onDrop: (event: React.DragEvent) => onDrop(event, section, row),
  });

  const save = () => {
    onSave(schema);
    setSavedJson(JSON.stringify(schema));
    if (problems.length) flash(`Saved. The engine will refuse to deploy it until ${problems.length === 1 ? 'one problem is' : `${problems.length} problems are`} fixed.`);
  };

  const mobile = device === 'mobile';
  const previewSample = useMemo(() => Object.fromEntries(schema.fields.map((field) => [field.id, sampleValue(field)])
    .filter(([, value]) => value !== undefined)), [schema.fields]);

  const canvas = (
    <div className={`mx-auto rounded-lg border border-hairline bg-mocha px-4 pb-4 pt-3 ${mobile ? 'max-w-[390px]' : 'max-w-[880px]'}`}>
      {sections.map((section: FormSection, s) => {
        const stepIndex = steps?.findIndex((step) => step.sections.includes(section.id)) ?? -1;
        const sectionSelected = selection?.kind === 'section' && selection.id === section.id;
        return (
          <div key={section.id} className={`-mx-2 mb-2 rounded-lg border border-dashed p-2 ${sectionSelected
            ? 'border-mineral-teal/70 bg-mineral-teal/5' : 'border-transparent hover:border-hairline'}`}>
            <button type="button" onClick={() => setSelection({ kind: 'section', id: section.id })}
              className="flex w-full items-center gap-2 text-left text-[13px] font-semibold text-linen">
              {section.title || <span className="font-normal italic text-sand-dim">Untitled section</span>}
              {stepIndex >= 0 && steps && steps.length > 1 && (
                <span className="rounded border border-amethyst/45 px-1.5 text-[10.5px] font-medium text-amethyst">
                  step {stepIndex + 1}. {steps[stepIndex].title}
                </span>
              )}
              {section.collapsible && <span className="font-mono text-[10px] font-normal text-sand-dim">collapsible</span>}
            </button>
            {section.description && <p className="mb-1 text-[11.5px] text-sand">{section.description}</p>}
            <div className="mt-1.5 grid gap-1.5">
              {section.rows.map((row, r) => {
                const key = `${s}:${r}`;
                const used = row.reduce((sum, cell) => sum + cellSpan(cell), 0);
                return (
                  <div key={key} {...dropProps(key, s, r)} data-form-row={key}
                    className={`relative grid min-h-[52px] gap-1.5 rounded-md p-0.5 ${dropTarget === key ? 'bg-mineral-teal/10 outline-1 outline-dashed outline-mineral-teal' : ''}`}
                    style={{ gridTemplateColumns: mobile ? 'minmax(0,1fr)' : 'repeat(4, minmax(0, 1fr))' }}>
                    {used >= 4 && dropTarget === key && (
                      <span className="absolute -top-2 right-1.5 rounded bg-mocha px-1 text-[9.5px] text-saffron">row full</span>
                    )}
                    {row.map((cell) => {
                      const field = schema.fields.find((candidate) => candidate.id === cellField(cell));
                      if (!field) return null;
                      const selected = selection?.kind === 'field' && selection.id === field.id;
                      return (
                        <div key={field.id} role="button" tabIndex={0} draggable data-form-cell={field.id}
                          aria-label={`${field.label || field.id}, ${field.type}, width ${cellSpan(cell)} of 4`}
                          aria-pressed={selected}
                          onClick={() => setSelection({ kind: 'field', id: field.id })}
                          onFocus={() => { if (!selected) setSelection({ kind: 'field', id: field.id }); }}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(DRAG_MOVE, field.id);
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          className={`relative min-w-0 cursor-pointer rounded-md border bg-charcoal px-2 pb-2 pt-1.5 focus:outline-none ${selected
                            ? 'border-mineral-teal ring-1 ring-inset ring-mineral-teal' : 'border-hairline hover:border-hairline-strong'}`}
                          style={{ gridColumn: mobile ? '1 / -1' : `span ${cellSpan(cell)}` }}>
                          {selected && (
                            <div className="absolute -top-3 right-1.5 z-10 flex items-center gap-0.5 rounded border border-hairline-strong bg-mocha-hover p-px">
                              <ToolButton label="Narrower (←)" onClick={() => act('narrow')}><ChevronLeft className="h-3 w-3" /></ToolButton>
                              <span className="px-0.5 font-mono text-[10px] text-linen">{cellSpan(cell)}/4</span>
                              <ToolButton label="Wider (→)" onClick={() => act('widen')}><ChevronRight className="h-3 w-3" /></ToolButton>
                              <ToolButton label="Move up (↑)" onClick={() => act('up')}><ArrowUp className="h-3 w-3" /></ToolButton>
                              <ToolButton label="Move down (↓)" onClick={() => act('down')}><ArrowDown className="h-3 w-3" /></ToolButton>
                              <ToolButton label="Remove (Delete)" onClick={() => act('remove')}><Trash2 className="h-3 w-3" /></ToolButton>
                            </div>
                          )}
                          <div className="flex min-w-0 items-center gap-1 text-[11.5px] font-semibold text-linen">
                            <span className="truncate">{field.label || field.id}</span>
                            {field.required && <span className="text-desert-rose">*</span>}
                            <span className="ml-auto shrink-0 font-mono text-[9.5px] font-normal text-sand-dim">{field.type}</span>
                          </div>
                          <Ghost field={field} />
                          {field.visible_when && (
                            <div className="mt-1 truncate font-mono text-[9.5px] text-amethyst" title="Show only when">if {field.visible_when}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div {...dropProps(`${s}:new`, s, -1)}
                className={`rounded-md border border-dashed p-1.5 text-center text-[11px] ${dropTarget === `${s}:new`
                  ? 'border-mineral-teal bg-mineral-teal/10 text-mineral-teal-bright' : 'border-hairline text-sand-dim'}`}>
                Drop a field here for a new row
              </div>
            </div>
          </div>
        );
      })}
      <button type="button" onClick={() => {
        const result = addSection(schema);
        history.set(result.schema);
        setSelection({ kind: 'section', id: result.id });
      }}
        className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-hairline text-[12px] text-sand hover:text-linen">
        <Plus className="h-3.5 w-3.5" /> Add section
      </button>
    </div>
  );

  const preview = (
    <div className={`mx-auto rounded-lg border border-hairline bg-mocha p-4 ${mobile ? 'max-w-[390px]' : 'max-w-[1024px]'}`}>
      <FormRenderer schema={schema} values={{ ...previewSample, ...previewValues }} onChange={setPreviewValues}
        width={mobile ? 358 : 990} showDensity />
    </div>
  );

  return createPortal(
    <AnimatePresence>
      <m.div key="form-designer" variants={backdropVariants} initial="initial" animate="enter" exit="exit"
        className="fixed inset-0 z-[var(--elevation-drawer)] bg-black/70 p-2 sm:p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget) requestClose();
        }}>
        <m.div variants={panelVariants} role="dialog" aria-modal="true" aria-label="Form designer"
          className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden rounded-xl border border-hairline bg-charcoal shadow-2xl">
          <header className="flex flex-wrap items-center gap-2 border-b border-hairline bg-mocha-deep px-3 py-2">
            <LayoutTemplate className="h-4 w-4 shrink-0 text-mineral-teal" />
            <input aria-label="Form title" value={schema.title ?? ''}
              onChange={(event) => history.set({ ...schema, title: event.target.value }, 'title')}
              className="w-56 max-w-[40vw] rounded border border-transparent bg-transparent px-1.5 py-0.5 text-[14px] font-semibold text-linen hover:border-hairline focus:border-hairline focus:outline-none" />
            {dirty && <span className="h-1.5 w-1.5 rounded-full bg-saffron" title="Unsaved changes" aria-label="Unsaved changes" />}
            <span className="hidden font-mono text-[11px] text-sand-dim md:inline">
              {location ?? 'new form'} · {inputs} field{inputs === 1 ? '' : 's'}
            </span>
            <span className="flex-1" />
            <ToolButton label="Undo (⌘Z)" onClick={history.undo} disabled={!history.canUndo} large><Undo2 className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="Redo (⇧⌘Z)" onClick={history.redo} disabled={!history.canRedo} large><Redo2 className="h-3.5 w-3.5" /></ToolButton>
            <Segmented value={mode} onChange={setMode} options={[{ value: 'design', label: 'Design' }, { value: 'preview', label: 'Preview' }]} />
            <Segmented value={device} onChange={setDevice} options={[
              { value: 'desktop', label: 'Desktop', icon: <Monitor className="h-3 w-3" /> },
              { value: 'mobile', label: 'Mobile', icon: <Smartphone className="h-3 w-3" /> },
            ]} />
            <button type="button" onClick={requestClose}
              className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-sand hover:bg-mocha hover:text-linen">
              <X className="h-3.5 w-3.5" /> Close <kbd className="rounded border border-hairline-strong px-1 font-mono text-[10px]">Esc</kbd>
            </button>
            <button type="button" onClick={save} disabled={saving}
              className="flex h-7 items-center gap-1.5 rounded-md bg-mineral-teal px-3 text-[12px] font-semibold text-charcoal hover:bg-mineral-teal-bright disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save form'}
            </button>
          </header>
          {guard && (
            <div role="alertdialog" aria-label="Unsaved changes"
              className="flex flex-wrap items-center gap-2 border-b border-saffron/35 bg-saffron/10 px-3 py-2 text-[12px] text-saffron">
              <strong className="font-semibold">Unsaved changes.</strong> Close without saving them?
              <span className="flex-1" />
              <button ref={keepEditing} type="button" onClick={() => setGuard(false)}
                className="h-7 rounded-md border border-hairline bg-mocha px-2.5 text-linen hover:bg-mocha-hover">Keep editing</button>
              <button type="button" onClick={onClose}
                className="h-7 rounded-md border border-desert-rose/50 bg-desert-rose/10 px-2.5 text-desert-rose hover:bg-desert-rose/20">Discard changes</button>
            </div>
          )}
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)_280px] xl:grid-cols-[216px_minmax(0,1fr)_300px]">
            <aside aria-label="Field palette" className="overflow-y-auto border-b border-hairline bg-mocha-deep p-3 md:border-b-0 md:border-r">
              {PALETTE.map((group) => (
                <div key={group.group} className="mb-3">
                  <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-moss">{group.group}</div>
                  <div className="grid grid-cols-2 gap-1">
                    {group.items.map((item) => (
                      <button key={item.type} type="button" draggable={!item.disabled} title={item.disabled ?? `Add ${item.label}`}
                        aria-disabled={!!item.disabled}
                        onClick={() => add(item.type)}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(DRAG_NEW, item.type);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        className={`flex h-7 items-center gap-1.5 rounded-md border border-hairline bg-charcoal px-2 text-left text-[12px] ${item.disabled
                          ? 'cursor-not-allowed opacity-45' : 'cursor-grab text-linen-muted hover:border-mineral-teal/60 hover:text-linen'}`}>
                        <span className="w-4 shrink-0 text-center font-mono text-[10.5px] text-sand">{item.glyph}</span>
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] leading-relaxed text-sand-dim">
                Drag a field into a row, or click to add it to the selected section. On a selected field, ↑ ↓ move it,
                ← → change its width, Alt+← → reorder it in its row, Delete removes it.
              </p>
            </aside>
            <main className="min-h-0 overflow-y-auto bg-charcoal p-3 sm:p-5"
              style={{ backgroundImage: 'radial-gradient(rgb(234 227 217 / 0.045) 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
              {mode === 'design' ? canvas : preview}
            </main>
            <aside aria-label="Properties" className="overflow-y-auto border-t border-hairline bg-mocha-deep p-3 md:border-l md:border-t-0">
              <FormProperties schema={schema} selection={selection}
                onField={(id, patch, key) => {
                  history.set(updateField(schema, id, patch), key);
                  if (patch.id && patch.id !== id) setSelection({ kind: 'field', id: patch.id });
                }}
                onSpan={(id, span) => history.set(setSpan(schema, id, span))}
                onSection={(id, patch, key) => history.set(updateSection(schema, id, patch), key)}
                onStepStart={(sectionId, on) => history.set(setStepStarts(schema,
                  on ? [...starts, sectionId] : starts.filter((id) => id !== sectionId)))}
                onRemoveSection={(id) => {
                  history.set(removeSection(schema, id));
                  setSelection(null);
                }} />
              {selectedField === undefined && selection?.kind !== 'section' && null}
            </aside>
          </div>
          {(problems.length > 0 || notice) && (
            <footer className="flex items-start gap-2 border-t border-hairline bg-mocha-deep px-3 py-1.5 text-[11.5px]" aria-live="polite">
              {notice ? <span className="text-linen">{notice}</span> : (
                <details className="min-w-0 text-saffron">
                  <summary className="flex cursor-pointer items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {problems.length === 1 ? '1 problem' : `${problems.length} problems`}: the engine refuses to deploy this form until they are fixed
                  </summary>
                  <ul className="mt-1 list-disc pl-5 text-sand">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
                </details>
              )}
            </footer>
          )}
        </m.div>
      </m.div>
    </AnimatePresence>,
    document.body,
  );
};

const ToolButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean; large?: boolean; children: React.ReactNode }> = ({
  label, onClick, disabled, large, children,
}) => (
  <button type="button" title={label} aria-label={label} disabled={disabled}
    onClick={(event) => { event.stopPropagation(); onClick(); }}
    className={`flex items-center justify-center rounded text-sand hover:bg-mocha hover:text-linen disabled:opacity-35 ${large ? 'h-7 w-7' : 'h-5 w-5'}`}>
    {children}
  </button>
);

function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (value: T) => void; options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-md border border-hairline bg-mocha-deep p-0.5" role="group">
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}
          className={`flex h-6 items-center gap-1 rounded px-2 text-[11.5px] font-medium ${value === option.value
            ? 'bg-mocha-hover text-linen' : 'text-sand hover:text-linen'}`}>
          {option.icon}{option.label}
        </button>
      ))}
    </div>
  );
}
