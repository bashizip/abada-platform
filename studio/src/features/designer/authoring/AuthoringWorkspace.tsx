import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Sparkles, X, Send, RotateCcw, Undo2, Pencil } from 'lucide-react';
import type { WorkflowFile, WorkflowNode } from '@/types';
import { MotionBackdrop, MotionPanel, StatusPill, Skeleton, EmptyState } from '@/components/ui';
import { PropertiesInspector } from '@/components/PropertiesInspector';
import { listItem, useMotionVariants } from '@/lib/motion';
import { stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import { nodeChanges } from '@/lib/apl/nodeChanges';
import type { DiffChangeKind } from '@/lib/aiDiff/types';
import { useAplValidation } from '@/hooks/useAplValidation';
import { DraftDiagram } from '../DraftDiagram';
import { useAuthoringSession } from './useAuthoringSession';
import type { AuthoringTurn } from './authoringSession';

type View = 'diagram' | 'yaml' | 'diff';

const VIEWS: Array<{ view: View; label: string }> = [
  { view: 'diagram', label: 'Diagram' },
  { view: 'yaml', label: 'YAML' },
  { view: 'diff', label: 'Diff vs current' },
];

/** After this long, a pending turn says the model can take a while. */
const SLOW_AFTER_MS = 4000;

export interface AuthoringWorkspaceProps {
  projectId: string | undefined;
  /** The process on the canvas when the workspace opened. */
  origin: WorkflowFile;
  /** Apply replaces that process, or opens the draft as a new process. */
  target: 'replace' | 'new';
  initialPrompt: string;
  onApply: (draft: WorkflowFile) => void;
  onDiscard: () => void;
}

const nodeLabel = (node: WorkflowNode | undefined) => node?.title || node?.id || 'the process';

/**
 * The AI draft workspace (M5 S12): a large dialog where a natural-language draft is refined
 * before it reaches the canvas. The diagram updates with each answer, the thread on the right
 * keeps every prompt and edit with "undo to here", and the user can edit the draft directly.
 * Apply installs the draft on the canvas as one undoable change; nothing is deployed.
 */
export const AuthoringWorkspace: React.FC<AuthoringWorkspaceProps> = ({
  projectId, origin, target, initialPrompt, onApply, onDiscard,
}) => {
  const session = useAuthoringSession(projectId, origin, target);
  const { state, draft, pending, canApply } = session;
  const [view, setView] = useState<View>('diagram');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composer, setComposer] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const composerRef = useRef<HTMLInputElement>(null);
  const turnsRef = useRef<HTMLDivElement>(null);
  const itemVariants = useMotionVariants(listItem);

  // The prompt typed in the bar is the first turn.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void session.submit(initialPrompt);
    composerRef.current?.focus();
  }, [initialPrompt, session]);

  // A pending turn shows how long it has been waiting.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  // A draft lives in this page only: leaving it asks first.
  const hasWork = canApply || !!pending;
  useEffect(() => {
    if (!hasWork) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasWork]);

  const validation = useAplValidation(draft, draft.nodes.length > 0);
  const issueTotal = useMemo(
    () => [...validation.issueCounts.values()].reduce((sum, count) => sum + count, 0) + validation.processIssues.length,
    [validation],
  );

  const changes = useMemo(() => nodeChanges(target === 'replace' ? origin : { ...origin, nodes: [], edges: [] }, draft),
    [origin, target, draft]);
  const changeKinds = useMemo(() => new Map<string, DiffChangeKind>(changes
    .filter((change) => change.kind !== 'removed')
    .map((change) => [change.id, change.kind === 'changed' ? 'modified' : 'added'])), [changes]);
  const removed = useMemo(() => changes.filter((change) => change.kind === 'removed')
    .map((change) => nodeLabel(origin.nodes.find((node) => node.id === change.id))), [changes, origin]);
  const nodeDiffKind = useCallback((id: string) => changeKinds.get(id) ?? null, [changeKinds]);

  const yaml = useMemo(() => (draft.nodes.length ? stringifyAPLYaml(workflowToAPL(draft)) : ''), [draft]);
  const selectedNode = selectedId ? draft.nodes.find((node) => node.id === selectedId) ?? null : null;
  useEffect(() => { if (selectedId && !selectedNode) setSelectedId(null); }, [selectedId, selectedNode]);

  const askDiscard = useCallback(() => {
    if (!hasWork) onDiscard();
    else setConfirmDiscard(true);
  }, [hasWork, onDiscard]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (selectedId) setSelectedId(null);
      else if (confirmDiscard) setConfirmDiscard(false);
      else askDiscard();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, confirmDiscard, askDiscard]);

  useEffect(() => {
    turnsRef.current?.scrollTo?.({ top: turnsRef.current.scrollHeight });
  }, [state.turns.length, pending]);

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    if (!composer.trim() || pending) return;
    setSelectedId(null);
    void session.submit(composer);
    setComposer('');
  };

  const editNode = (updated: WorkflowNode) => session.edit(
    (current) => ({ ...current, nodes: current.nodes.map((node) => (node.id === updated.id ? updated : node)) }),
    `Changed “${nodeLabel(updated)}”`, updated.id);
  const editWorkflow = (updater: (wf: WorkflowFile) => WorkflowFile) =>
    session.edit(updater, selectedNode ? `Changed “${nodeLabel(selectedNode)}”` : 'Changed the process', selectedId ?? undefined);

  const liveTurns = state.turns.filter((turn) => turn.status === 'done' && !turn.setAside);
  const lastLiveId = liveTurns[liveTurns.length - 1]?.id;
  const setAside = state.turns.filter((turn) => turn.setAside).length;
  const firstPrompt = state.turns.find((turn) => turn.kind === 'prompt')?.id;
  const title = target === 'new' ? 'New process' : origin.name || 'This process';

  return (
    <>
      <MotionBackdrop initial="initial" animate="enter" exit="exit"
        className="fixed inset-0 z-50 bg-charcoal-veil/80 backdrop-blur-sm" onClick={askDiscard} />
      <MotionPanel initial="initial" animate="enter" exit="exit"
        role="dialog" aria-modal="true" aria-labelledby="authoring-workspace-title"
        className="fixed inset-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-hairline-strong bg-charcoal shadow-warm-xl">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline bg-mocha-deep px-4 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amethyst/40 bg-amethyst/15">
            <Sparkles className="h-4 w-4 text-amethyst" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="authoring-workspace-title" className="truncate text-sm font-semibold text-linen">AI draft · {title}</h2>
            <p className="truncate text-[11px] text-sand">
              {target === 'replace'
                ? 'The canvas does not change until you apply this draft.'
                : 'Opens as a new, unsaved process when you apply it.'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div role="tablist" aria-label="View" className="flex rounded-lg border border-hairline bg-charcoal p-0.5">
              {VIEWS.map(({ view: option, label }) => (
                <button key={option} type="button" role="tab" aria-selected={view === option}
                  onClick={() => { setView(option); if (option === 'yaml') setSelectedId(null); }}
                  className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                    view === option ? 'bg-mocha-hover text-linen' : 'text-sand hover:text-linen'}`}>
                  {label}
                </button>
              ))}
            </div>
            {pending ? <StatusPill tone="running" label="Working" live />
              : draft.nodes.length === 0 ? null
                : issueTotal > 0 ? <StatusPill tone="warning" label={`${issueTotal} issue${issueTotal === 1 ? '' : 's'}`} />
                  : <StatusPill tone="success" label="Valid" />}
            <button type="button" onClick={askDiscard} aria-label="Close the draft"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-sand hover:bg-mocha-hover hover:text-linen">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <section aria-label="Draft" className="relative min-h-[260px] min-w-0 flex-1 border-b border-hairline md:border-b-0 md:border-r">
            {draft.nodes.length === 0 ? (
              pending ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 px-8">
                  <p className="text-sm text-linen">Drafting your process…</p>
                  <div className="w-full max-w-sm"><Skeleton lines={3} label="Drafting" /></div>
                </div>
              ) : (
                <EmptyState className="h-full" icon={<Sparkles className="h-6 w-6" />} title="No draft yet"
                  description="Describe the process on the right. The draft appears here, and you can refine it before it reaches the canvas." />
              )
            ) : view === 'yaml' ? (
              <pre aria-label="APL source" className="absolute inset-0 overflow-auto bg-charcoal-ink p-4 font-mono text-[11px] leading-relaxed text-linen-muted">{yaml}</pre>
            ) : (
              <>
                <DraftDiagram
                  nodes={draft.nodes}
                  edges={draft.edges}
                  animateChanges
                  issueCounts={validation.issueCounts}
                  nodeDiffKind={view === 'diff' ? nodeDiffKind : undefined}
                  onSelectNode={pending ? undefined : setSelectedId}
                  selectedNodeId={selectedId}
                />
                {view === 'diff' && (
                  <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5 text-[10px]" data-testid="diff-summary">
                    <span className="rounded-md border border-sage-green/40 bg-charcoal/90 px-2 py-0.5 text-sage-green">
                      {changes.filter((c) => c.kind === 'added').length} added</span>
                    <span className="rounded-md border border-saffron/40 bg-charcoal/90 px-2 py-0.5 text-saffron">
                      {changes.filter((c) => c.kind === 'changed').length} changed</span>
                    <span className="rounded-md border border-desert-rose/40 bg-charcoal/90 px-2 py-0.5 text-desert-rose"
                      title={removed.join(', ') || undefined}>
                      {removed.length} removed{removed.length ? `: ${removed.join(', ')}` : ''}</span>
                    <span className="rounded-md border border-hairline bg-charcoal/90 px-2 py-0.5 text-sand">
                      {target === 'replace' ? 'against the process on the canvas' : 'a new process'}</span>
                  </div>
                )}
                <AnimatePresence>
                  {selectedNode && (
                    <m.div key="inspector" variants={itemVariants} initial="initial" animate="enter" exit="exit"
                      className="absolute bottom-3 left-3 top-12 z-10 flex w-[340px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-xl border border-hairline-strong shadow-warm-lg">
                      <div className="flex shrink-0 items-center justify-between border-b border-hairline bg-mocha-deep px-3 py-1.5 text-[10px] text-sand">
                        <span className="flex items-center gap-1.5"><Pencil className="h-3 w-3" /> Your edits go into the draft</span>
                        <button type="button" onClick={() => setSelectedId(null)} aria-label="Close properties"
                          className="text-sand hover:text-linen"><X className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="min-h-0 flex-1">
                        <PropertiesInspector
                          selectedNode={selectedNode}
                          onUpdateNode={editNode}
                          onUpdateWorkflow={editWorkflow}
                          workflow={draft}
                          nodeCount={draft.nodes.length}
                          projectId={projectId}
                          issues={validation.issuesByNode.get(selectedNode.id)}
                        />
                      </div>
                    </m.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </section>

          <aside aria-label="Conversation" className="flex min-h-0 w-full shrink-0 flex-col bg-mocha-deep md:w-[360px]">
            <h3 className="px-4 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-wider text-sand">Conversation</h3>
            <div ref={turnsRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 pb-3" aria-live="polite">
              <AnimatePresence initial={false}>
                {state.turns.map((turn) => (
                  <m.div key={turn.id} variants={itemVariants} initial="initial" animate="enter" exit="exit">
                    <TurnCard turn={turn} first={turn.id === firstPrompt} now={now}
                      canUndoHere={turn.status === 'done' && !turn.setAside && turn.id !== lastLiveId && !pending}
                      onUndoHere={() => { setSelectedId(null); session.undoTo(turn.id); }}
                      onCancel={session.cancel}
                      onRetry={() => session.retry(turn.id)}
                      onEditPrompt={() => { setComposer(turn.text); session.dismiss(turn.id); composerRef.current?.focus(); }} />
                  </m.div>
                ))}
              </AnimatePresence>
              {setAside > 0 && (
                <p className="px-1 text-[11px] text-sand">
                  {setAside} later step{setAside === 1 ? '' : 's'} set aside ·{' '}
                  <button type="button" onClick={session.restore} className="text-amethyst-light underline underline-offset-2 hover:text-linen">Restore</button>
                  {' '}· the next refinement drops {setAside === 1 ? 'it' : 'them'}
                </p>
              )}
            </div>
            <form onSubmit={send} className="shrink-0 space-y-2 border-t border-hairline px-3 py-3">
              <div className="flex gap-2">
                <input ref={composerRef} value={composer} onChange={(event) => setComposer(event.target.value)}
                  aria-label="Refine the draft" disabled={!!pending}
                  placeholder={draft.nodes.length ? 'Refine: add, remove or change a step…' : 'Describe the process…'}
                  className="min-w-0 flex-1 rounded-lg border border-hairline bg-charcoal px-2.5 py-2 text-xs text-linen placeholder-sand focus:border-amethyst/60 focus:outline-none disabled:opacity-60" />
                <button type="submit" disabled={!composer.trim() || !!pending}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amethyst to-saffron px-3 text-xs font-semibold text-white disabled:from-hairline disabled:to-hairline disabled:text-sand">
                  <Send className="h-3.5 w-3.5" /> Send
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-sand-dim">
                Each refinement starts from the draft as you see it, including your edits. The model runs in the
                authoring service and sees the draft and your latest prompt.
              </p>
            </form>
          </aside>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-hairline bg-mocha-deep px-4 py-2.5">
          {confirmDiscard ? (
            <div role="alertdialog" aria-label="Discard the draft" className="flex flex-1 flex-wrap items-center gap-2 text-xs text-linen-muted">
              <span>Discard this draft? The canvas stays exactly as it was.</span>
              <button type="button" autoFocus onClick={() => setConfirmDiscard(false)}
                className="h-8 rounded-lg border border-hairline bg-mocha px-3 text-xs text-linen hover:bg-mocha-hover">Keep editing</button>
              <button type="button" onClick={() => { session.cancel(); onDiscard(); }}
                className="h-8 rounded-lg border border-desert-rose/50 bg-charcoal px-3 text-xs font-semibold text-desert-rose hover:bg-mocha-hover">Discard draft</button>
            </div>
          ) : (
            <>
              <p className="min-w-[200px] flex-1 text-[11px] text-sand">
                {pending ? 'You can switch views, read the draft or cancel while the model works.'
                  : `${target === 'replace' ? 'Apply replaces the process on the canvas as one change you can undo.'
                    : 'Apply opens the draft as a new process.'}${issueTotal > 0 && canApply
                    ? ` It applies with ${issueTotal} issue${issueTotal === 1 ? '' : 's'}, still shown on the canvas.` : ''} Nothing is deployed.`}
              </p>
              <button type="button" onClick={askDiscard}
                className="h-8 rounded-lg border border-hairline bg-mocha px-3 text-xs text-linen hover:bg-mocha-hover">Discard</button>
              <button type="button" disabled={!canApply} onClick={() => onApply(draft)}
                className="h-8 rounded-lg bg-amethyst px-4 text-xs font-semibold text-white hover:bg-amethyst-light disabled:cursor-not-allowed disabled:bg-hairline disabled:text-sand">
                Apply to Studio
              </button>
            </>
          )}
        </footer>
      </MotionPanel>
    </>
  );
};

const TurnCard: React.FC<{
  turn: AuthoringTurn;
  first: boolean;
  now: number;
  canUndoHere: boolean;
  onUndoHere: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onEditPrompt: () => void;
}> = ({ turn, first, now, canUndoHere, onUndoHere, onCancel, onRetry, onEditPrompt }) => {
  const waited = Math.max(1, Math.round((now - turn.startedAt) / 1000));
  const frame = turn.kind === 'edit' ? 'border-dashed bg-transparent'
    : turn.status === 'failed' ? 'border-desert-rose/50 bg-mocha' : 'bg-mocha';
  return (
    <div data-testid="authoring-turn" data-status={turn.status}
      className={`space-y-1.5 rounded-xl border border-hairline px-3 py-2.5 transition-opacity ${frame} ${turn.setAside ? 'opacity-40' : ''}`}>
      <div className="flex items-center justify-between gap-2 text-[9.5px] font-semibold uppercase tracking-wider text-sand">
        <span>{turn.kind === 'edit' ? 'Your edit' : first ? 'Prompt' : 'Refinement'}</span>
        {turn.status === 'pending' && <span className="font-normal normal-case tracking-normal">working · {waited} s</span>}
      </div>
      <p className="text-xs leading-relaxed text-linen">{turn.text}</p>
      {turn.status === 'pending' && (
        <>
          <Skeleton className="h-2 w-full" label="Waiting for the model" />
          <div className="flex items-center justify-between gap-2 text-[10.5px] text-sand">
            <span>{now - turn.startedAt > SLOW_AFTER_MS
              ? 'Still working: a draft can take up to a minute.'
              : 'Asking the model in the authoring service…'}</span>
            <button type="button" onClick={onCancel} className="text-amethyst-light underline underline-offset-2 hover:text-linen">Cancel</button>
          </div>
        </>
      )}
      {turn.status === 'failed' && (
        <>
          <p role="alert" className="border-l-2 border-desert-rose pl-2 text-[11px] leading-relaxed text-linen-muted">
            {turn.error} The draft is unchanged.
          </p>
          <div className="flex gap-3 text-[11px]">
            <button type="button" onClick={onRetry} className="flex items-center gap-1 text-amethyst-light underline underline-offset-2 hover:text-linen">
              <RotateCcw className="h-3 w-3" /> Try again</button>
            <button type="button" onClick={onEditPrompt} className="text-amethyst-light underline underline-offset-2 hover:text-linen">Edit prompt</button>
          </div>
        </>
      )}
      {turn.status === 'done' && turn.kind === 'prompt' && (
        <>
          <p className="border-l-2 border-amethyst/50 pl-2 text-[11px] leading-relaxed text-linen-muted">
            {turn.summary || `Drafted ${turn.draft?.nodes.length ?? 0} steps.`}
          </p>
          <p className="font-mono text-[10px] text-sand">
            {turn.request}{turn.operations ? ` · ${turn.operations} operation${turn.operations === 1 ? '' : 's'}` : ''}
            {turn.attempts ? ` · ${turn.attempts} attempt${turn.attempts === 1 ? '' : 's'}` : ''}
            {turn.model ? ` · ${turn.model}` : ''}
          </p>
          {turn.warnings && turn.warnings.length > 0 && (
            <ul className="space-y-0.5 text-[10.5px] text-saffron">
              {turn.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </>
      )}
      {canUndoHere && (
        <button type="button" onClick={onUndoHere}
          className="flex items-center gap-1 text-[11px] text-amethyst-light underline underline-offset-2 hover:text-linen">
          <Undo2 className="h-3 w-3" /> Undo to here
        </button>
      )}
    </div>
  );
};
