import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Code2, Loader2, Minus, Plus, RotateCcw, Type, X } from 'lucide-react';
import { AplAPI, type AplValidationIssue, type AplValidationResult } from '@/api/apl';
import { issueLine, sortIssues } from '@/lib/apl/issues';
import type { APLDocument } from '@/lib/apl/types';
import { aplToWorkflow, parseAPLYaml, stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import { WorkflowFile } from '@/types';

interface AplEditorProps {
  workflow: WorkflowFile;
  initialSource?: string;
  candidate?: {
    provider: 'LLM' | 'LOCAL_FALLBACK';
    model?: string;
    attempts: number;
    warnings: string[];
  };
  onApply: (workflow: WorkflowFile) => void;
  onDiscard?: () => void;
}

type EngineCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'done'; result: AplValidationResult }
  | { state: 'unavailable'; message: string };

const VALIDATION_DEBOUNCE_MS = 600;

/** Local YAML syntax check only; every APL rule is checked by the engine. */
const parseLocally = (source: string): { document?: APLDocument; error?: string } => {
  try {
    const document = parseAPLYaml(source);
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      return { error: 'APL source must be a YAML mapping' };
    }
    return { document };
  } catch (reason) {
    return { error: `YAML syntax: ${reason instanceof Error ? reason.message.split('\n')[0] : String(reason)}` };
  }
};

const valueToken = (value: string) => {
  if (/^\s*#/.test(value)) return 'text-[#737D69]';
  if (/\b(true|false|null)\b/.test(value)) return 'text-[#E76F51]';
  if (/[-+]?\d+(\.\d+)?/.test(value)) return 'text-[#2A9D8F]';
  return 'text-[#EAE3D9]';
};

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 18;
const DEFAULT_FONT_SIZE = 12;

const HighlightedYaml: React.FC<{
  lines: string[];
  fontSize: number;
  preRef: React.RefObject<HTMLPreElement | null>;
  scrollTop: number;
  scrollLeft: number;
}> = ({
  lines, fontSize, preRef, scrollTop, scrollLeft,
}) => (
  <pre
    ref={preRef}
    aria-hidden="true"
    className="absolute inset-0 m-0 overflow-visible whitespace-pre font-mono pointer-events-none"
    style={{
      fontSize,
      lineHeight: `${fontSize + 8}px`,
      transform: `translate(${-scrollLeft}px, ${-scrollTop}px)`,
    }}
  >
    {lines.map((line, index) => {
      const comment = line.match(/^(\s*)(#.*)$/);
      const keyed = line.match(/^(\s*)([- ]*)([\w.-]+)(\s*:)(.*)$/);
      return (
        <React.Fragment key={`${index}-${line.length}`}>
          {comment ? <><span>{comment[1]}</span><span className="text-[#737D69]">{comment[2]}</span></>
            : keyed ? <>
              <span>{keyed[1]}{keyed[2]}</span>
              <span className="text-[#F4A261]">{keyed[3]}</span>
              <span className="text-[#A89F91]">{keyed[4]}</span>
              <span className={valueToken(keyed[5])}>{keyed[5]}</span>
            </> : <span className={valueToken(line)}>{line}</span>}
          {'\n'}
        </React.Fragment>
      );
    })}
  </pre>
);

export const AplEditor: React.FC<AplEditorProps> = ({ workflow, initialSource, candidate, onApply, onDiscard }) => {
  const canonicalSource = useMemo(() => initialSource || stringifyAPLYaml(workflowToAPL(workflow)),
    [initialSource, workflow]);
  const [source, setSource] = useState(canonicalSource);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef({ top: 0, left: 0 });
  const lines = useMemo(() => source.split('\n'), [source]);
  const dirty = source !== canonicalSource;

  const adjustFontSize = (delta: number) => {
    setFontSize((current) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, current + delta)));
  };

  const syncScroll = (target: HTMLTextAreaElement) => {
    scrollRef.current = { top: target.scrollTop, left: target.scrollLeft };
    if (highlightRef.current) {
      highlightRef.current.style.transform = `translate(${-target.scrollLeft}px, ${-target.scrollTop}px)`;
    }
    if (gutterRef.current) {
      gutterRef.current.style.transform = `translateY(${-target.scrollTop}px)`;
    }
  };

  const [check, setCheck] = useState<EngineCheck>({ state: 'idle' });
  const validationSequence = useRef(0);

  /** Validates with the engine; stale responses (an older keystroke) are ignored. */
  const validateWithEngine = useCallback(async (text: string): Promise<AplValidationResult | null> => {
    const sequence = ++validationSequence.current;
    setCheck({ state: 'checking' });
    try {
      const result = await AplAPI.validate(text);
      if (sequence === validationSequence.current) setCheck({ state: 'done', result });
      return result;
    } catch (reason) {
      if (sequence === validationSequence.current) {
        setCheck({ state: 'unavailable', message: reason instanceof Error ? reason.message : String(reason) });
      }
      return null;
    }
  }, []);

  useEffect(() => {
    if (parseLocally(source).error) {
      validationSequence.current++;
      setCheck({ state: 'idle' });
      return undefined;
    }
    const timer = window.setTimeout(() => { void validateWithEngine(source); }, VALIDATION_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [source, validateWithEngine]);

  const issues = useMemo(() => check.state === 'done' ? sortIssues(check.result.issues) : [],
    [check]);
  const errorCount = issues.filter((issue) => issue.severity === 'ERROR').length;

  /** Moves the cursor to the YAML lines an issue points at. */
  const revealIssue = (issue: AplValidationIssue) => {
    const editor = editorRef.current;
    const line = issueLine(source, issue);
    if (!editor || line < 0) return;
    const start = lines.slice(0, line).reduce((offset, text) => offset + text.length + 1, 0);
    editor.focus();
    editor.setSelectionRange(start, start + lines[line].length);
    editor.scrollTop = Math.max(0, line * (fontSize + 8) - editor.clientHeight / 3);
    syncScroll(editor);
  };

  const apply = async () => {
    const { document, error: syntaxError } = parseLocally(source);
    if (!document) {
      setError(syntaxError ?? 'APL source is empty');
      return;
    }
    // The engine is the validator; when it is unreachable the diagram still
    // applies and the same checks run again when the document is saved or deployed.
    const result = await validateWithEngine(source);
    if (result && !result.valid) {
      const errors = result.issues.filter((issue) => issue.severity === 'ERROR').length;
      setError(`${errors} error${errors === 1 ? '' : 's'} must be fixed before applying`);
      return;
    }
    try {
      const parsed = aplToWorkflow(document);
      onApply({
        ...parsed,
        id: workflow.id,
        documentId: workflow.documentId,
        revision: workflow.revision,
        version: workflow.version,
        updatedAt: workflow.updatedAt,
        description: workflow.description,
      });
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="flex-1 min-w-0 h-full bg-[#1A1614] flex flex-col" aria-label="APL YAML editor">
      <div className="h-12 border-b border-[#3A322E] px-4 flex items-center justify-between bg-[#211C19]">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-[#F4A261]" />
          <span className="text-xs font-semibold">{workflow.name}</span>
          <span className="text-[10px] font-mono text-[#2A9D8F] bg-[#2A9D8F]/10 border border-[#2A9D8F]/30 px-1.5 py-0.5 rounded">abada.io/v1</span>
          {candidate && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${candidate.provider === 'LLM'
              ? 'text-[#9D4EDD] border-[#9D4EDD]/30 bg-[#9D4EDD]/10'
              : 'text-[#F4A261] border-[#F4A261]/30 bg-[#F4A261]/10'}`}>
              {candidate.provider === 'LLM' ? `${candidate.model || 'LLM'} · ${candidate.attempts} attempt(s)` : 'Local fallback'}
            </span>
          )}
          {dirty && <span className="text-[10px] text-[#F4A261]">Modified</span>}
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center rounded-lg border border-[#3A322E] bg-[#1A1614]"
            role="group"
            aria-label="Editor font size"
          >
            <span className="pl-2 text-[#737D69]" aria-hidden="true"><Type className="w-3.5 h-3.5" /></span>
            <button
              type="button"
              onClick={() => adjustFontSize(-1)}
              disabled={fontSize === MIN_FONT_SIZE}
              aria-label="Decrease editor font size"
              className="p-1.5 text-[#A89F91] hover:text-[#EAE3D9] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Minus className="w-3 h-3" />
            </button>
            <output className="w-10 text-center font-mono text-[10px] text-[#EAE3D9]" aria-live="polite">
              {fontSize}px
            </output>
            <button
              type="button"
              onClick={() => adjustFontSize(1)}
              disabled={fontSize === MAX_FONT_SIZE}
              aria-label="Increase editor font size"
              className="p-1.5 text-[#A89F91] hover:text-[#EAE3D9] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          {onDiscard && (
            <button onClick={onDiscard}
              className="px-2.5 py-1.5 rounded-lg border border-[#3A322E] text-[11px] text-[#A89F91] hover:text-[#E76F51] flex items-center gap-1.5">
              <X className="w-3 h-3" /> Discard
            </button>
          )}
          <button onClick={() => { setSource(canonicalSource); setError(null); }}
            className="px-2.5 py-1.5 rounded-lg border border-[#3A322E] text-[11px] text-[#A89F91] hover:text-[#EAE3D9] flex items-center gap-1.5">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <button onClick={() => { void apply(); }}
            className="px-3 py-1.5 rounded-lg bg-[#F4A261] text-[#1A1614] text-[11px] font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Apply to diagram
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 m-4 rounded-xl border border-[#3A322E] bg-[#151210] overflow-hidden shadow-inner">
        <div className="absolute left-0 top-0 bottom-0 w-12 bg-[#1C1816] border-r border-[#3A322E] text-right pr-3 pt-4 font-mono text-[#655D55] select-none overflow-hidden">
          <div ref={gutterRef} style={{
            fontSize: Math.max(9, fontSize - 2),
            lineHeight: `${fontSize + 8}px`,
            transform: `translateY(${-scrollRef.current.top}px)`,
          }}>
            {lines.map((_, index) => <div key={index}>{index + 1}</div>)}
          </div>
        </div>
        <div className="absolute left-16 right-4 top-4 bottom-4 overflow-hidden">
          <HighlightedYaml
            lines={lines}
            fontSize={fontSize}
            preRef={highlightRef}
            scrollTop={scrollRef.current.top}
            scrollLeft={scrollRef.current.left}
          />
          <textarea
            ref={editorRef}
            value={source}
            onChange={(event) => { setSource(event.target.value); setError(null); }}
            onScroll={(event) => syncScroll(event.currentTarget)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault(); void apply();
              }
              if (event.key === 'Tab') {
                event.preventDefault();
                const target = event.currentTarget;
                // insertText goes through the browser's edit history, so the
                // textarea's native undo (Cmd/Ctrl+Z) still covers indentation.
                if (!document.execCommand?.('insertText', false, '  ')) {
                  const start = target.selectionStart;
                  const next = `${source.slice(0, start)}  ${source.slice(target.selectionEnd)}`;
                  setSource(next);
                  requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2; });
                }
              }
            }}
            spellCheck={false}
            aria-label="APL YAML source"
            className="absolute inset-0 w-full h-full resize-none overflow-auto whitespace-pre bg-transparent font-mono outline-none text-transparent caret-[#F4A261] selection:bg-[#9D4EDD]/40"
            style={{ WebkitTextFillColor: 'transparent', fontSize, lineHeight: `${fontSize + 8}px` }}
          />
        </div>
      </div>

      {issues.length > 0 && (
        <ul className="mx-4 mb-2 max-h-36 overflow-y-auto rounded-xl border border-[#3A322E] bg-[#151210] divide-y divide-[#2A2421]"
          aria-label="APL validation issues">
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.path}-${index}`}>
              <button type="button" onClick={() => revealIssue(issue)}
                className="w-full text-left px-3 py-1.5 flex items-start gap-2 text-[11px] hover:bg-[#211C19]">
                {issue.severity === 'ERROR'
                  ? <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#E76F51]" aria-label="Error" />
                  : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#F4A261]" aria-label="Warning" />}
                <span className="min-w-0">
                  <span className="text-[#EAE3D9]">{issue.message}</span>
                  {issue.suggestedResolution && (
                    <span className="block text-[#737D69]">{issue.suggestedResolution}</span>
                  )}
                </span>
                {issue.elementId && (
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-[#A89F91]">{issue.elementId}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="h-10 px-4 border-t border-[#3A322E] flex items-center gap-3 text-[11px]">
        {error ? <span className="text-[#E76F51] flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{error}</span>
          : check.state === 'checking' ? <span className="text-[#A89F91] flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Validating with the engine…</span>
          : check.state === 'done' && errorCount > 0 ? <span className="text-[#E76F51]">{errorCount} error{errorCount === 1 ? '' : 's'} · {issues.length - errorCount} warning{issues.length - errorCount === 1 ? '' : 's'}</span>
          : check.state === 'done' && issues.length > 0 ? <span className="text-[#F4A261]">Valid with {issues.length} warning{issues.length === 1 ? '' : 's'}; warnings become errors in 1.1.0</span>
          : check.state === 'done' ? <span className="text-[#90A955] flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />Valid APL</span>
          : check.state === 'unavailable' ? <span className="text-[#A89F91]">Engine validation unavailable; the engine checks again on save and deploy.</span>
          : <span className="text-[#737D69]">Paste or edit canonical APL YAML. Press Ctrl/⌘+S to validate and apply.</span>}
        {candidate?.warnings.length ? (
          <span className="ml-auto truncate text-[#F4A261]" title={candidate.warnings.join(' · ')}>
            {candidate.warnings.join(' · ')}
          </span>
        ) : null}
      </div>
    </section>
  );
};
