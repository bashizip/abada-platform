import React, { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { EVENT_SIZE } from '@/lib/layout/nodeGeometry';
import { useCanvasView } from '../canvasContext';
import { eventAccent } from './nodeStyle';
import { kindOf } from './nodeCatalog';
import { EventShape } from './shapes';
import { kindIcon } from './kindIcons';
import { ArrivalPulse, DiffBadge, IncidentPulse, TrailHighlight, NodeBadges, NodeHandles, OutsideLabel, PathBadges, StatusBadge } from './NodeChrome';
import { type CanvasNode, pathClass, pathFill, stateOutline, withPathHint } from './nodeState';

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
  const kind = kindOf(data);
  const Icon = kindIcon(kind);

  return (
    <div
      className={`abada-node relative ${pathClass(data)}`}
      style={{ width: EVENT_SIZE, height: EVENT_SIZE, opacity: data.diffKind === 'removed' ? 0.6 : undefined }}
      title={withPathHint(data, data.diffAnnotation || data.description || undefined)}
    >
      <svg width={EVENT_SIZE} height={EVENT_SIZE} overflow="visible" className="absolute inset-0" aria-hidden="true">
        {outline && (
          <circle cx={C} cy={C} r={C + 5} fill="none" stroke={outline} strokeWidth="2" opacity="0.75"
            className={data.isLiveCurrent ? 'abada-live-outline' : undefined} />
        )}
        <EventShape kind={kind} color={color} fill={pathFill(data, color)} ended={data.nowState === 'ended'} />
      </svg>
      {Icon && (
        <Icon className="absolute h-4 w-4" style={{ left: C - 8, top: C - 8, color }} aria-hidden="true" />
      )}
      <OutsideLabel text={data.title} size={size} direction={direction} />
      <StatusBadge status={data.status} live={data.isLiveCurrent} now={data.nowState} retry={data.retryPhase} x={EVENT_SIZE - 4} y={4} />
      <ArrivalPulse seq={data.arrivalSeq} shape="circle" />
      <IncidentPulse seq={data.incidentSeq} shape="circle" />
      <TrailHighlight on={data.trailHighlight} shape="circle" />
      <PathBadges visits={data.visitOrders} width={EVENT_SIZE} height={EVENT_SIZE} />
      <DiffBadge kind={data.diffKind} />
      <NodeBadges loopState={data.loopState} maxIterations={data.loop?.maxIterations} issueCount={data.issueCount} />
      <NodeHandles />
    </div>
  );
});

EventNode.displayName = 'EventNode';
