import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m, type TargetAndTransition } from 'motion/react';
import { ArrowDown, Bot, Cpu, Filter, Server, UserCheck, X } from 'lucide-react';
import type { ActivityHistoryDTO } from '@/api/engine';
import type { AgentStepEvidence } from '@/api/evidence';
import type { WorkflowFile } from '@/types';
import { AgentStepInspector } from '@/features/operations/AgentStepInspector';
import { JsonViewer } from '@/components/json/JsonViewer';
import { jsonHeight } from '@/components/json/jsonLayout';
import { EVENT_ICON, TONE_TEXT } from '@/features/operations/instanceTelemetry';
import { buildAuditTrail, type NodeTrailEntry, type TrailActorKind, type TrailEntry, type TrailStatus } from '@/lib/run/auditTrail';
import { eventMeta } from '@/lib/run/instanceDetail';
import { formatDuration } from '@/lib/run/instanceFormat';
import { listItem, useMotionVariants, useReducedMotion } from '@/lib/motion';

/** Within this distance of the bottom, the trail follows new entries. */
const FOLLOW_SLACK_PX = 24;
/** Delay between entries that arrive together (a parallel split), in seconds. */
const STAGGER_S = 0.06;

const ACTOR_ICON: Record<TrailActorKind, React.ElementType> = {
  engine: Cpu,
  agent: Bot,
  human: UserCheck,
  worker: Server,
};

const STATUS_TEXT: Record<TrailStatus, string> = {
  waiting: 'text-saffron',
  running: 'text-amethyst',
  completed: 'text-sage-green',
  failed: 'text-desert-rose',
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export interface LiveAuditTrailProps {
  /** The history the trail may show: the playback's trail prefix, in playback order. */
  history: ActivityHistoryDTO[];
  workflow: WorkflowFile | null;
  agentSteps?: AgentStepEvidence[];
  projectId?: string;
  instanceId?: string;
  onOpenInstance?: (instanceId: string) => void;
  /** A history row to bring into view and mark (e.g. the retry an incident card resolved). */
  highlightId?: string | null;
  /** Show only the entries about this node (the node selected on the canvas). */
  filterNodeId?: string | null;
  onClearFilter?: () => void;
  /** The node of the entry under the pointer or the keyboard focus, null when none. */
  onHoverNode?: (nodeId: string | null) => void;
  className?: string;
}

/**
 * The live audit trail (M5 S5): one entry per pass through a node, arriving
 * in step with the canvas playback. It follows new entries while the user is
 * at the bottom; scrolled up, it stays put and counts what arrived below.
 */
export const LiveAuditTrail: React.FC<LiveAuditTrailProps> = ({
  history, workflow, agentSteps = [], projectId, instanceId, onOpenInstance,
  highlightId, filterNodeId, onClearFilter, onHoverNode, className = '',
}) => {
  const promptVersions = useMemo(() => new Map(agentSteps
    .filter((step) => step.promptVersion)
    .map((step) => [step.externalTaskId, step.promptVersion as string])), [agentSteps]);
  const allEntries = useMemo(() => buildAuditTrail(history, workflow, promptVersions),
    [history, workflow, promptVersions]);
  const entries = useMemo(() => (filterNodeId
    ? allEntries.filter((entry) => entry.nodeId === filterNodeId) : allEntries), [allEntries, filterNodeId]);
  const highlightEntryId = useMemo(() => (highlightId
    ? allEntries.find((entry) => entry.facts.some((fact) => fact.id === highlightId))?.id ?? null : null),
  [allEntries, highlightId]);

  const [expanded, setExpanded] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const reduced = useReducedMotion();
  const variants = useMotionVariants(listItem);

  /* Entries not yet committed are new; those arriving together enter one after another (a parallel split). */
  const seen = useRef<Set<string> | null>(null);
  const fresh = seen.current === null ? [] : allEntries.filter((entry) => !seen.current?.has(entry.id));
  const freshKey = fresh.map((entry) => entry.id).join(',');
  const enter = (entryId: string): TargetAndTransition => {
    const at = fresh.findIndex((entry) => entry.id === entryId);
    const target = variants.enter as TargetAndTransition;
    return at <= 0 ? target : { ...target, transition: { ...target.transition, delay: STAGGER_S * at } };
  };

  const toBottom = (smooth: boolean) => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth && !reduced ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    const firstRender = seen.current === null;
    seen.current = new Set(allEntries.map((entry) => entry.id));
    if (firstRender) { toBottom(false); return; }
    const arrived = freshKey ? freshKey.split(',').filter((id) => !filterNodeId
      || allEntries.find((entry) => entry.id === id)?.nodeId === filterNodeId).length : 0;
    if (arrived === 0) return;
    if (following.current) toBottom(true);
    else setUnseen((count) => count + arrived);
    // Only new entries move the view; refetches of the same facts do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshKey]);

  /* Opening a filter or a highlighted entry starts from a known place. */
  useEffect(() => {
    following.current = true;
    setUnseen(0);
    toBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterNodeId]);

  const highlighted = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!highlightEntryId) return;
    setExpanded(highlightEntryId);
    following.current = false;
    highlighted.current?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [highlightEntryId, reduced]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK_PX;
    following.current = atBottom;
    if (atBottom) setUnseen(0);
  };

  const filterTitle = filterNodeId
    ? workflow?.nodes.find((node) => node.id === filterNodeId)?.title || filterNodeId : null;

  return (
    <div className={`relative flex min-h-0 flex-col ${className}`}>
      {filterNodeId && (
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2 text-[11px] text-sand">
          <Filter className="h-3 w-3 text-saffron" aria-hidden />
          <span>Only</span>
          <button
            type="button"
            onClick={onClearFilter}
            className="flex items-center gap-1 rounded-full border border-saffron/40 bg-saffron/10 px-2 py-0.5 font-semibold text-saffron transition-colors hover:bg-saffron/20"
            aria-label={`Show every step (now only ${filterTitle})`}
          >
            {filterTitle} <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      )}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        data-testid="audit-trail-scroller"
      >
        {entries.length === 0 ? (
          <p className="p-4 text-[11px] text-sand">
            {filterNodeId ? 'Nothing recorded at this step yet.' : 'No audit events recorded yet.'}
          </p>
        ) : (
          <ol className="relative my-4 ml-6 mr-4 space-y-1 border-l border-hairline pl-4" aria-label="Audit trail" aria-live="polite">
            <AnimatePresence initial={false}>
              {entries.map((entry) => (
                <m.li
                  key={entry.id}
                  ref={entry.id === highlightEntryId ? highlighted : undefined}
                  variants={variants}
                  initial="initial"
                  animate={enter(entry.id)}
                  exit="exit"
                  className={`relative pb-2 ${entry.id === highlightEntryId ? 'rounded-md ring-1 ring-saffron/60' : ''}`}
                  aria-current={entry.id === highlightEntryId ? 'true' : undefined}
                  data-entry-id={entry.id}
                  onMouseEnter={() => onHoverNode?.(entry.nodeId ?? null)}
                  onMouseLeave={() => onHoverNode?.(null)}
                  onFocus={() => onHoverNode?.(entry.nodeId ?? null)}
                  onBlur={() => onHoverNode?.(null)}
                >
                  <TrailRow
                    entry={entry}
                    expanded={expanded === entry.id}
                    onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                    agentSteps={agentSteps}
                    projectId={projectId}
                    instanceId={instanceId}
                    onOpenInstance={onOpenInstance}
                  />
                </m.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>
      {unseen > 0 && (
        <button
          type="button"
          onClick={() => { following.current = true; setUnseen(0); toBottom(true); }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-saffron/50 bg-mocha px-3 py-1 text-[11px] font-semibold text-saffron shadow-warm-lg transition-colors hover:bg-saffron/10"
        >
          <ArrowDown className="h-3 w-3" aria-hidden />
          {unseen} new {unseen === 1 ? 'entry' : 'entries'}
        </button>
      )}
    </div>
  );
};

const TrailRow: React.FC<{
  entry: TrailEntry;
  expanded: boolean;
  onToggle: () => void;
  agentSteps: AgentStepEvidence[];
  projectId?: string;
  instanceId?: string;
  onOpenInstance?: (instanceId: string) => void;
}> = ({ entry, expanded, onToggle, agentSteps, projectId, instanceId, onOpenInstance }) => {
  const isNode = entry.kind === 'node';
  const Icon = isNode ? ACTOR_ICON[entry.actor.kind] : EVENT_ICON[entry.facts[0].eventType] ?? Cpu;
  const tone = isNode ? STATUS_TEXT[entry.status] : TONE_TEXT[entry.tone];
  const steps = isNode && entry.actor.kind === 'agent'
    ? agentSteps.filter((step) => entry.externalTaskIds.includes(step.externalTaskId)) : [];
  return (
    <>
      <span className={`absolute -left-[25px] top-1 flex h-4 w-4 items-center justify-center rounded-full border border-hairline bg-charcoal ${tone}`}>
        <Icon className="h-2.5 w-2.5" aria-hidden />
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full rounded-md px-2 py-1 text-left transition-colors hover:bg-mocha-hover/60 focus-visible:bg-mocha-hover/60 focus-visible:outline-none"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] text-linen">
            {isNode && <span className="font-semibold">{entry.title}</span>}
            {isNode && <span className="text-sand"> · </span>}
            <span className={isNode ? tone : 'font-semibold'}>{entry.action}</span>
          </span>
          <span className="shrink-0 font-mono text-[10px] text-sand">{clock(entry.at)}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-sand">
          {isNode ? <ActorLine entry={entry} /> : <span>by {entry.actorName}</span>}
          {isNode && entry.durationMs !== undefined && (
            <span className="font-mono tabular-nums">{formatDuration(entry.durationMs)}</span>
          )}
          {isNode && entry.exit && <span className="font-mono text-saffron">{entry.exit}</span>}
        </div>
      </button>
      {expanded && (
        <div className="mt-1 space-y-1.5 pl-2">
          {isNode && entry.outcome && (
            <p className="text-[10px] text-sand">
              Outcome <span className="font-mono text-linen">{entry.outcome}</span>
              {entry.commentLength !== undefined && ` · commented (${entry.commentLength} characters)`}
            </p>
          )}
          {steps.length > 0 && (
            <AgentStepInspector steps={steps} projectId={projectId} instanceId={instanceId} onOpenInstance={onOpenInstance} />
          )}
          <ul className="space-y-1" aria-label="Recorded facts">
            {entry.facts.map((fact) => (
              <li key={fact.id} className="rounded-lg border border-hairline bg-charcoal p-2">
                <div className="flex items-baseline justify-between gap-2 text-[10px]">
                  <span className="font-semibold text-linen">{eventMeta(fact.eventType).label}</span>
                  <span className="font-mono text-sand">{clock(fact.occurredAt)} · {fact.actor}</span>
                </div>
                {Object.keys(fact.details ?? {}).length > 0 && (
                  <div className="mt-1">
                    <JsonViewer data={fact.details} label="details" compact defaultDepth={2} height={jsonHeight(fact.details)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
};

const ActorLine: React.FC<{ entry: NodeTrailEntry }> = ({ entry }) => {
  const { actor } = entry;
  switch (actor.kind) {
    case 'agent':
      return (
        <span className="text-amethyst">
          Agent{actor.model && <span className="font-mono"> · {actor.model}</span>}
          {actor.prompt && <span className="font-mono text-sand"> · prompt {actor.prompt}</span>}
        </span>
      );
    case 'human':
      return <span className="text-desert-rose">{actor.name ?? 'A person'}</span>;
    case 'worker':
      return <span className="font-mono text-mineral-teal">worker {actor.name ?? '—'}</span>;
    default:
      return <span>Engine</span>;
  }
};
