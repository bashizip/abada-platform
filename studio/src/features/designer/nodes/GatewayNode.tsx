import React, { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { GATEWAY_SIZE, diamond } from '@/lib/layout/nodeGeometry';
import { useCanvasView } from '../canvasContext';
import { NODE_ACCENT } from './nodeStyle';
import { kindOf } from './nodeCatalog';
import { GatewayShape } from './shapes';
import { ArrivalPulse, DiffBadge, IncidentPulse, TrailHighlight, NodeBadges, NodeHandles, OutsideLabel, PathBadges, StatusBadge } from './NodeChrome';
import { type CanvasNode, pathClass, pathFill, stateOutline, withPathHint } from './nodeState';

const S = GATEWAY_SIZE;

const SUBTYPE_LABEL: Record<string, string> = {
  exclusive: 'Exclusive gateway',
  parallel: 'Parallel gateway',
  inclusive: 'Inclusive gateway',
  event: 'Event-based gateway',
};

export const GatewayNode = memo(({ data, selected }: NodeProps<CanvasNode>) => {
  const { direction } = useCanvasView();
  const color = NODE_ACCENT.gateway;
  const outline = stateOutline(data, selected);
  const kind = SUBTYPE_LABEL[data.subtype ?? 'exclusive'] ?? SUBTYPE_LABEL.exclusive;

  return (
    <div
      className={`abada-node relative ${pathClass(data)}`}
      style={{ width: S, height: S, opacity: data.diffKind === 'removed' ? 0.6 : undefined }}
      title={withPathHint(data, data.diffAnnotation || [kind, data.description].filter(Boolean).join(' — '))}
    >
      <svg width={S} height={S} overflow="visible" className="absolute inset-0" aria-hidden="true">
        {outline && (
          <polygon points={diamond(-6)} fill="none" stroke={outline} strokeWidth="2" strokeLinejoin="round" opacity="0.75"
            className={data.isLiveCurrent ? 'abada-live-outline' : undefined} />
        )}
        <GatewayShape kind={kindOf(data)} color={color} fill={pathFill(data, color)} />
      </svg>
      <OutsideLabel text={data.title} size={{ width: S, height: S }} direction={direction} />
      <StatusBadge status={data.status} live={data.isLiveCurrent} now={data.nowState} retry={data.retryPhase} x={S - 8} y={8} />
      <ArrivalPulse seq={data.arrivalSeq} shape="diamond" />
      <IncidentPulse seq={data.incidentSeq} shape="diamond" />
      <TrailHighlight on={data.trailHighlight} shape="diamond" />
      <PathBadges visits={data.visitOrders} join={data.join} width={S} height={S} />
      <DiffBadge kind={data.diffKind} />
      <NodeBadges loopState={data.loopState} maxIterations={data.loop?.maxIterations} issueCount={data.issueCount} />
      <NodeHandles />
    </div>
  );
});

GatewayNode.displayName = 'GatewayNode';
