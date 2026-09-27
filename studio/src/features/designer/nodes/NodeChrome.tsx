import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import type { DiffChangeKind } from '@/lib/aiDiff/types';
import {
  OUTSIDE_LABEL_GAP,
  OUTSIDE_LABEL_MAX_WIDTH,
  type FlowDirection,
  type Size,
} from '@/lib/layout/nodeGeometry';
import { DIFF_COLORS, LIVE_COLOR, type NodeRunStatus } from './nodeState';

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

/** Real run state from the engine (never guessed), as a corner badge. */
export const StatusBadge: React.FC<{ status?: NodeRunStatus; live?: boolean; x: number; y: number }> = ({ status, live, x, y }) => {
  const badge = status && status !== 'idle' ? STATUS_BADGES[status] : null;
  if (!badge && !live) return null;
  return (
    <span
      className="pointer-events-none absolute z-30 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      style={{ left: x, top: y }}
      title={badge?.label ?? 'Current live activity'}
    >
      {live && <span className="absolute h-full w-full rounded-full bg-[#9D4EDD]/50 animate-ping" />}
      <span
        className="relative flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-[#1A1614]"
        style={{ background: badge?.color ?? LIVE_COLOR }}
      >
        {badge?.icon}
      </span>
    </span>
  );
};

const STATUS_BADGES: Record<Exclude<NodeRunStatus, 'idle'>, { label: string; color: string; icon: React.ReactNode }> = {
  completed: { label: 'Completed', color: '#90A955', icon: <CheckCircle2 className="h-3 w-3 text-[#1A1614]" /> },
  failed: { label: 'Failed', color: '#E76F51', icon: <XCircle className="h-3 w-3 text-[#1A1614]" /> },
  waiting: { label: 'Waiting', color: '#F4A261', icon: <Clock className="h-3 w-3 text-[#1A1614]" /> },
  running: { label: 'Running', color: '#9D4EDD', icon: <Loader2 className="h-3 w-3 animate-spin text-[#EAE3D9]" /> },
};

/** AI-diff marking above the node. */
export const DiffBadge: React.FC<{ kind?: DiffChangeKind | null }> = ({ kind }) => {
  if (!kind) return null;
  const color = DIFF_COLORS[kind];
  return (
    <span
      className="pointer-events-none absolute -top-3 left-3 z-30 rounded-full border bg-[#1A1614] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
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
      className="pointer-events-none absolute line-clamp-2 text-[11px] font-medium leading-[14px] text-[#EAE3D9]"
      style={style}
    >
      {text}
    </span>
  );
};
