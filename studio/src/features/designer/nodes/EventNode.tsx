import React, { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Clock, Mail, Radio } from 'lucide-react';
import { EVENT_SIZE } from '@/lib/layout/nodeGeometry';
import { useCanvasView } from '../canvasContext';
import { eventAccent } from './nodeStyle';
import { DiffBadge, NodeHandles, OutsideLabel, StatusBadge } from './NodeChrome';
import { type CanvasNode, stateOutline } from './nodeState';

const C = EVENT_SIZE / 2;

/**
 * BPMN event: a circle. Start events have a thin ring, end events a thick
 * one, and intermediate catch events (timer, message, signal) a double ring
 * around their trigger icon.
 */
export const EventNode = memo(({ data, selected }: NodeProps<CanvasNode>) => {
  const { direction } = useCanvasView();
  const size = { width: EVENT_SIZE, height: EVENT_SIZE };
  const color = eventAccent(data.subtype);
  const outline = stateOutline(data, selected);
  const isEnd = data.subtype === 'end';
  const isCatch = data.subtype === 'timer' || data.subtype === 'message' || data.subtype === 'signal';
  const ring = isEnd ? 4 : 2;
  const Icon = data.subtype === 'timer' ? Clock : data.subtype === 'message' ? Mail : data.subtype === 'signal' ? Radio : null;

  return (
    <div
      className="abada-node relative"
      style={{ width: EVENT_SIZE, height: EVENT_SIZE, opacity: data.diffKind === 'removed' ? 0.6 : 1 }}
      title={data.diffAnnotation || data.description || undefined}
    >
      <svg width={EVENT_SIZE} height={EVENT_SIZE} overflow="visible" className="absolute inset-0" aria-hidden="true">
        {outline && (
          <circle cx={C} cy={C} r={C + 5} fill="none" stroke={outline} strokeWidth="2" opacity="0.75"
            className={data.isLiveCurrent ? 'abada-live-outline' : undefined} />
        )}
        <circle cx={C} cy={C} r={C - ring / 2} fill="#25201D" stroke={color} strokeWidth={ring} />
        {isCatch && <circle cx={C} cy={C} r={C - 5} fill="none" stroke={color} strokeWidth="1.5" />}
      </svg>
      {Icon && (
        <Icon className="absolute h-4 w-4" style={{ left: C - 8, top: C - 8, color }} aria-hidden="true" />
      )}
      <OutsideLabel text={data.title} size={size} direction={direction} />
      <StatusBadge status={data.status} live={data.isLiveCurrent} x={EVENT_SIZE - 4} y={4} />
      <DiffBadge kind={data.diffKind} />
      <NodeHandles />
    </div>
  );
});

EventNode.displayName = 'EventNode';
