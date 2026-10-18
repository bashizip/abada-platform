import React, { useContext, useId, useState } from 'react';
import { SectionScope } from './sectionScope';
import { AnimatePresence, m } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import type { AplValidationIssue } from '@/api/apl';
import { enterExit, useMotionVariants } from '@/lib/motion';
import { MONO_INPUT } from './fieldStyles';

/**
 * The building blocks every node editor in the properties panel uses, so each
 * node reads the same way: collapsible sections, fields with a plain label, the
 * APL key as a hint, one line of help and the engine's issue right under it.
 */



const storageKey = (scope: string, id: string) => `abada.inspector.${scope}.${id}`;

function readOpen(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === 'open';
  } catch {
    return fallback;
  }
}

function writeOpen(key: string, open: boolean) {
  try {
    localStorage.setItem(key, open ? 'open' : 'closed');
  } catch {
    // Storage is a convenience; the section still works without it.
  }
}

/** Issues shown in a section heading: errors in rose, warnings in saffron. */
export const IssueCount: React.FC<{ issues: AplValidationIssue[] }> = ({ issues }) => {
  if (!issues.length) return null;
  const errors = issues.filter((issue) => issue.severity === 'ERROR').length;
  return (
    <span className={`rounded-full px-1.5 py-px font-mono text-[9px] font-semibold ${errors
      ? 'bg-desert-rose/15 text-desert-rose' : 'bg-saffron/15 text-saffron'}`}
    title={`${issues.length} validation issue${issues.length === 1 ? '' : 's'}`}>
      {issues.length}
    </span>
  );
};

/**
 * A titled group of fields that opens and closes; the choice is remembered per
 * node kind. Sections holding an engine issue always open.
 */
export const Section: React.FC<{
  id: string;
  title: string;
  icon?: React.ReactNode;
  /** One line under the title saying what the section is for. */
  summary?: string;
  issues?: AplValidationIssue[];
  defaultOpen?: boolean;
  /** Controls on the heading's right, e.g. an Expand button. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ id, title, icon, summary, issues = [], defaultOpen = true, actions, children }) => {
  const scope = useContext(SectionScope);
  const key = storageKey(scope, id);
  const [open, setOpen] = useState(() => readOpen(key, defaultOpen));
  const bodyId = useId();
  const variants = useMotionVariants(enterExit);
  const shown = open || issues.some((issue) => issue.severity === 'ERROR');
  const toggle = () => {
    setOpen(!shown);
    writeOpen(key, !shown);
  };
  return (
    <section className="border-t border-hairline pt-3" data-section={id}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={toggle} aria-expanded={shown} aria-controls={bodyId}
          className="group flex min-w-0 flex-1 items-center gap-2 text-left">
          {icon && <span className="shrink-0 text-sand group-hover:text-linen">{icon}</span>}
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-sand group-hover:text-linen">{title}</span>
          <IssueCount issues={issues} />
          <ChevronDown className={`ml-auto h-3.5 w-3.5 shrink-0 text-sand transition-transform duration-[var(--duration-fast)] ${shown ? '' : '-rotate-90'}`} aria-hidden="true" />
        </button>
        {actions}
      </div>
      <AnimatePresence initial={false}>
        {shown && (
          <m.div key="body" id={bodyId} variants={variants} initial="initial" animate="enter" exit="exit" className="space-y-3 pt-3">
            {summary && <p className="text-[10px] leading-relaxed text-sand">{summary}</p>}
            {children}
          </m.div>
        )}
      </AnimatePresence>
    </section>
  );
};

/** The issues an engine reported for one field (or rule), right under it. */
export const FieldIssues: React.FC<{ issues?: AplValidationIssue[] }> = ({ issues = [] }) => (
  <>
    {issues.map((issue, index) => (
      <p key={index} role={issue.severity === 'ERROR' ? 'alert' : undefined}
        className={`text-[10px] leading-relaxed ${issue.severity === 'ERROR' ? 'text-desert-rose' : 'text-saffron'}`}>
        {issue.message}
        {issue.suggestedResolution && <span className="text-sand"> — {issue.suggestedResolution}</span>}
      </p>
    ))}
  </>
);

/**
 * One labelled field. `apl` names the key it is saved as (shown small, for
 * people who also read the YAML); `help` says what it does or what empty means.
 */
export const Field: React.FC<{
  label: string;
  apl?: string;
  help?: React.ReactNode;
  issues?: AplValidationIssue[];
  /** The label's `for`: the id of the control. */
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ label, apl, help, issues, htmlFor, children }) => (
  <div className="space-y-1">
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-xs text-linen-muted">{label}</label>
      {apl && <code className="shrink-0 font-mono text-[9px] text-sand-dim">{apl}</code>}
    </div>
    {children}
    {help && <p className="text-[10px] leading-relaxed text-sand">{help}</p>}
    <FieldIssues issues={issues} />
  </div>
);

/** A number field whose empty value means "engine default" (`undefined`). */
export const NumberInput: React.FC<{
  value?: number;
  onChange: (value: number | undefined) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number | string;
  placeholder?: string;
  id?: string;
}> = ({ value, onChange, label, min, max, step = 1, placeholder = 'engine default', id }) => (
  <input id={id} type="number" aria-label={label} min={min} max={max} step={step} placeholder={placeholder}
    value={value ?? ''} className={MONO_INPUT}
    onChange={(event) => {
      const raw = event.target.value.trim();
      const parsed = Number(raw);
      onChange(raw === '' || !Number.isFinite(parsed) ? undefined : parsed);
    }} />
);

/** A short note in the panel: what is deprecated, reserved or advisory. */
export const Note: React.FC<{ tone?: 'info' | 'warning'; children: React.ReactNode }> = ({ tone = 'info', children }) => (
  <div className={`rounded-lg border px-2.5 py-2 text-[10px] leading-relaxed ${tone === 'warning'
    ? 'border-saffron/30 bg-saffron/10 text-linen-muted' : 'border-hairline bg-charcoal text-sand'}`}>
    {children}
  </div>
);
