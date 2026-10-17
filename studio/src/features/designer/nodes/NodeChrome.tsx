import type { LoopProblem } from '@/lib/apl/loopAnalysis';
import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, UserRound, XCircle } from 'lucide-react';
import type { NowState } from '@/lib/run/instancePath';
import type { DiffChangeKind } from '@/lib/aiDiff/types';
import {
  OUTSIDE_LABEL_GAP,
  OUTSIDE_LABEL_MAX_WIDTH,
  type FlowDirection,
  type Size,
} from '@/lib/layout/nodeGeometry';
import { DIFF_COLORS, LIVE_COLOR, type NodeRunStatus } from './nodeState';
import { palette } from '@/lib/tokens';
import { EDGE_COLORS } from '../edgeStyle';

const EDGE_PATH_COLOR = EDGE_COLORS.path;

/**
 * One connection handle per side, all of type `source`: a flow rendering
 * these nodes must use `ConnectionMode.Loose`, or React Flow finds no target
 * handle and silently drops every edge. A drag can start from any side;
 * handles stay invisible unless an editable node is hovered (see index.css).
 */
export const NodeHandles: React.FC = () => (
  <>
    <Handle id="left" type="source" position={Position.Left} className="abada-handle" />
    <Handle id="right" type="source" position={Position.Right} className="abada-handle" />
    <Handle id="top" type="source" position={Position.Top} className="abada-handle" />
    <Handle id="bottom" type="source" position={Position.Bottom} className="abada-handle" />
  </>
);

/**
 * Real run state from the engine (never guessed), as a corner badge. Where
 * the instance is now wins: a human waiting shows a person, an incident a
 * warning sign (shape and icon, never colour alone).
 */
export const StatusBadge: React.FC<{ status?: NodeRunStatus; live?: boolean; now?: NowState; x: number; y: number }> = ({
  status, live, now, x, y,
}) => {
  const badge = now === 'incident' ? NOW_BADGES.incident
    : now === 'waiting' ? NOW_BADGES.waiting
      : status && status !== 'idle' ? STATUS_BADGES[status] : null;
  if (!badge && !live) return null;
  return (
    <span
      className="pointer-events-none absolute z-30 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      style={{ left: x, top: y }}
      title={badge?.label ?? 'Current live activity'}
    >
      {live && <span className="absolute h-full w-full rounded-full bg-amethyst/50 animate-ping" />}
      <span
        className="relative flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-charcoal"
        style={{ background: badge?.color ?? LIVE_COLOR }}
      >
        {badge?.icon}
      </span>
    </span>
  );
};

const NOW_BADGES: Record<'incident' | 'waiting', { label: string; color: string; icon: React.ReactNode }> = {
  incident: { label: 'Incident — stopped here', color: palette.desertRose, icon: <AlertTriangle className="h-3 w-3 text-charcoal" /> },
  waiting: { label: 'Waiting for a person', color: palette.saffron, icon: <UserRound className="h-3 w-3 text-charcoal" /> },
};

/**
 * Path facts on a node of an instance: its visit number(s) on the path
 * (`2`, `2 ×3` when it ran three times), how many branches a join received
 * (`2/2`) and the child results of a delegation (`3 ✓ · 1 ✗`).
 */
export const PathBadges: React.FC<{
  visits?: number[];
  join?: { arrived: number; expected: number };
  childResults?: { ok: number; failed: number };
  width: number;
  height: number;
}> = ({ visits, join, childResults: children, width, height }) => (
  <>
    {visits && visits.length > 0 && (
      <span
        className="pointer-events-none absolute z-30 flex h-[18px] min-w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-0.5 rounded-full border-2 border-charcoal px-1 text-[10px] font-bold leading-none text-charcoal"
        style={{ left: 2, top: 2, background: EDGE_PATH_COLOR }}
        title={visits.length > 1 ? `Ran ${visits.length} times — steps ${visits.join(', ')}` : `Step ${visits[0]} of the path`}
        aria-label={visits.length > 1 ? `Steps ${visits.join(', ')}` : `Step ${visits[0]}`}
      >
        {visits[0]}
        {visits.length > 1 && <span className="font-semibold">×{visits.length}</span>}
      </span>
    )}
    {join && (
      <span
        className="pointer-events-none absolute z-30 -translate-x-1/2 rounded-full border bg-charcoal px-1.5 text-[9px] font-semibold leading-4"
        style={{
          // Above the shape: its title sits below it.
          left: width / 2, top: -18,
          color: join.arrived >= join.expected ? EDGE_PATH_COLOR : palette.saffron,
          borderColor: join.arrived >= join.expected ? EDGE_PATH_COLOR : palette.saffron,
        }}
        title={`${join.arrived} of ${join.expected} branches arrived`}
      >
        {join.arrived}/{join.expected}
      </span>
    )}
    {children && (children.ok > 0 || children.failed > 0) && (
      <span
        className="pointer-events-none absolute z-30 rounded-full border border-hairline bg-charcoal px-1.5 text-[9px] font-semibold leading-4 text-linen"
        style={{ right: 6, top: height - 8 }}
        title={`${children.ok} child run(s) succeeded, ${children.failed} failed`}
      >
        {children.ok} ✓{children.failed > 0 && <> · <span className="text-desert-rose">{children.failed} ✗</span></>}
      </span>
    )}
  </>
);

const STATUS_BADGES: Record<Exclude<NodeRunStatus, 'idle'>, { label: string; color: string; icon: React.ReactNode }> = {
  completed: { label: 'Completed', color: palette.sageGreen, icon: <CheckCircle2 className="h-3 w-3 text-charcoal" /> },
  failed: { label: 'Failed', color: palette.desertRose, icon: <XCircle className="h-3 w-3 text-charcoal" /> },
  waiting: { label: 'Waiting', color: palette.saffron, icon: <Clock className="h-3 w-3 text-charcoal" /> },
  running: { label: 'Running', color: palette.amethyst, icon: <Loader2 className="h-3 w-3 animate-spin text-linen" /> },
};

/**
 * Paced playback (M5 S3): the node a revealed step entered pulses once in the
 * path colour, then rests. Keyed by the arrival so a loop re-entry pulses again.
 */
export const ArrivalPulse: React.FC<{ seq?: number; shape: 'rect' | 'circle' | 'diamond' }> = ({ seq, shape }) => {
  if (!seq) return null;
  return (
    <span key={seq} className="abada-arrive-node pointer-events-none absolute inset-0 z-20" aria-hidden="true">
      <span
        className={`absolute inset-0 border-2 ${shape === 'rect' ? 'rounded-xl' : shape === 'circle' ? 'rounded-full' : ''}`}
        style={{
          borderColor: EDGE_PATH_COLOR,
          // A diamond is a square turned a quarter: its corners touch the shape's box.
          transform: shape === 'diamond' ? 'rotate(45deg) scale(0.7071)' : undefined,
        }}
      />
    </span>
  );
};

/** AI-diff marking above the node. */
export const DiffBadge: React.FC<{ kind?: DiffChangeKind | null }> = ({ kind }) => {
  if (!kind) return null;
  const color = DIFF_COLORS[kind];
  return (
    <span
      className="pointer-events-none absolute -top-3 left-3 z-30 rounded-full border bg-charcoal px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
      style={{ color, borderColor: `${color}80` }}
    >
      {kind}
    </span>
  );
};

/**
 * Title of an event or gateway, outside its shape: below it in horizontal
 * flows, to its right in vertical ones (where edges leave from below).
 */
export const OutsideLabel: React.FC<{ text: string; size: Size; direction: FlowDirection }> = ({ text, size, direction }) => {
  if (!text) return null;
  const style: React.CSSProperties = direction === 'vertical'
    ? { left: size.width + OUTSIDE_LABEL_GAP, top: size.height / 2, transform: 'translateY(-50%)', width: OUTSIDE_LABEL_MAX_WIDTH, textAlign: 'left' }
    : { top: size.height + OUTSIDE_LABEL_GAP, left: size.width / 2, transform: 'translateX(-50%)', width: OUTSIDE_LABEL_MAX_WIDTH, textAlign: 'center' };
  return (
    <span
      className="pointer-events-none absolute line-clamp-2 text-[11px] font-medium leading-[14px] text-linen"
      style={style}
    >
      {text}
    </span>
  );
};

/**
 * Editing badges above a node's top-left corner: the repeat limit of a loop
 * step (red when a cycle returns here without a usable bound) and the count
 * of engine validation issues pointing at the node.
 */
export const NodeBadges: React.FC<{
  loopState?: 'bounded' | LoopProblem;
  maxIterations?: number;
  issueCount?: number;
}> = ({ loopState, maxIterations, issueCount }) => {
  if (!loopState && !issueCount) return null;
  return (
    <span className="pointer-events-none absolute -top-3 left-1 z-30 flex gap-1">
      {loopState && (
        <span
          className="rounded-full border px-1.5 text-[9px] font-semibold leading-4"
          style={loopState === 'bounded'
            ? { borderColor: palette.saffron, color: palette.saffron, background: palette.charcoal }
            : { borderColor: palette.desertRose, color: palette.charcoal, background: palette.desertRose }}
          title={loopState === 'bounded' ? `Repeats at most ${maxIterations} times` : 'Cycle without a usable repeat limit'}
        >
          ↻ {loopState === 'bounded' ? maxIterations : '!'}
        </span>
      )}
      {!!issueCount && (
        <span
          className="rounded-full border border-desert-rose bg-charcoal px-1.5 text-[9px] font-semibold leading-4 text-desert-rose"
          title={`${issueCount} validation issue${issueCount > 1 ? 's' : ''}`}
        >
          ⚠ {issueCount}
        </span>
      )}
    </span>
  );
};

