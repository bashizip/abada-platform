import React, { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { GATEWAY_SIZE } from '@/lib/layout/nodeGeometry';
import { useCanvasView } from '../canvasContext';
import { NODE_ACCENT } from './nodeStyle';
import { DiffBadge, NodeHandles, OutsideLabel, StatusBadge } from './NodeChrome';
import { type CanvasNode, stateOutline } from './nodeState';

const S = GATEWAY_SIZE;
const C = S / 2;

/** Diamond whose tips touch the bounding-box side midpoints, i.e. the ports. */
const diamond = (inset: number) => `${C},${inset} ${S - inset},${C} ${C},${S - inset} ${inset},${C}`;

/** BPMN gateway marker: X exclusive, + parallel, O inclusive, pentagon event-based. */
function GatewayMarker({ subtype, color }: { subtype?: string; color: string }) {
  switch (subtype) {
    case 'parallel':
      return <path d={`M ${C} ${C - 11} V ${C + 11} M ${C - 11} ${C} H ${C + 11}`} stroke={color} strokeWidth="3.5" strokeLinecap="round" />;
    case 'inclusive':
      return <circle cx={C} cy={C} r="9" fill="none" stroke={color} strokeWidth="3" />;
    case 'event': {
      const pentagon = Array.from({ length: 5 }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        return `${(C + Math.cos(a) * 6.5).toFixed(2)},${(C + Math.sin(a) * 6.5).toFixed(2)}`;
      }).join(' ');
      return (
        <g fill="none" stroke={color} strokeWidth="1.5">
          <circle cx={C} cy={C} r="12.5" />
          <circle cx={C} cy={C} r="10" />
          <polygon points={pentagon} strokeLinejoin="round" />
        </g>
      );
    }
    default:
      return <path d={`M ${C - 8} ${C - 8} L ${C + 8} ${C + 8} M ${C + 8} ${C - 8} L ${C - 8} ${C + 8}`} stroke={color} strokeWidth="3.5" strokeLinecap="round" />;
  }
}

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
      className="abada-node relative"
      style={{ width: S, height: S, opacity: data.diffKind === 'removed' ? 0.6 : 1 }}
      title={data.diffAnnotation || [kind, data.description].filter(Boolean).join(' — ')}
    >
      <svg width={S} height={S} overflow="visible" className="absolute inset-0" aria-hidden="true">
        {outline && (
          <polygon points={diamond(-6)} fill="none" stroke={outline} strokeWidth="2" strokeLinejoin="round" opacity="0.75"
            className={data.isLiveCurrent ? 'abada-live-outline' : undefined} />
        )}
        <polygon points={diamond(1)} fill="#25201D" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        <GatewayMarker subtype={data.subtype} color={color} />
      </svg>
      <OutsideLabel text={data.title} size={{ width: S, height: S }} direction={direction} />
      <StatusBadge status={data.status} live={data.isLiveCurrent} x={S - 8} y={8} />
      <DiffBadge kind={data.diffKind} />
      <NodeHandles />
    </div>
  );
});

GatewayNode.displayName = 'GatewayNode';
