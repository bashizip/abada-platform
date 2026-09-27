import React, { memo } from 'react';
import type { Edge, EdgeProps, InternalNode } from '@xyflow/react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode } from '@xyflow/react';
import type { DiffChangeKind } from '@/lib/aiDiff/types';
import {
  type EdgeKind,
  type EdgeRoute,
  type OutcomeSlot,
  cleanEdgeLabel,
  defaultFlowSlash,
  isOutcomeKind,
  labelAnchor,
  roundedPath,
  routeFallback,
  truncateLabel,
} from '@/lib/layout/edgeGeometry';
import {
  type FlowDirection,
  type NodeShape,
  type Rect,
  outcomePortPoint,
  sizeOfShape,
} from '@/lib/layout/nodeGeometry';
import { EDGE_COLORS, type EdgeVariant } from './edgeStyle';
import { type CanvasLayoutSnapshot, useCanvasView, useCompactZoom, useMarkerUrl } from './canvasContext';

export type AbadaEdgeData = {
  label?: string;
  kind?: EdgeKind;
  /** Boundary-marker slot of an outcome route on its source node. */
  outcomeSlot?: OutcomeSlot;
  /** Lane among parallel edges between the same pair of nodes. */
  lane?: number;
  /** Animated flow dash — token edges, next edges, or dry-run-adjacent edges. */
  isFlowing?: boolean;
  /** Taken execution path — static purple highlight, no animation. */
  isTakenPath?: boolean;
  /** Draws the token dot that arrives into the currently active node. */
  hasToken?: boolean;
  /** Incident to the selected node. */
  isHighlighted?: boolean;
  /** Another node is selected and this edge is not incident to it. */
  isDimmed?: boolean;
  diffKind?: DiffChangeKind | null;
};

type AbadaEdgeType = Edge<AbadaEdgeData, 'abadaEdge'>;

/** Duration of one token pass along the edge into the active node. */
const TOKEN_DURATION_S = 1.6;

function rectOf(node: InternalNode): Rect {
  const size = sizeOfShape((node.type ?? 'task') as NodeShape);
  return { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, ...size };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1;

/**
 * The route to draw: the auto-layout's own route while both nodes still sit
 * where the layout put them, otherwise an orthogonal fallback computed from
 * the current geometry.
 */
function resolveRoute(
  edgeId: string,
  source: Rect,
  target: Rect,
  sourceId: string,
  targetId: string,
  data: AbadaEdgeData | undefined,
  direction: FlowDirection,
  layout: CanvasLayoutSnapshot | null,
): EdgeRoute {
  const laid = layout?.routes.get(edgeId);
  const sPos = layout?.positions.get(sourceId);
  const tPos = layout?.positions.get(targetId);
  if (laid && sPos && tPos
    && near(sPos.x, source.x) && near(sPos.y, source.y)
    && near(tPos.x, target.x) && near(tPos.y, target.y)) {
    return laid;
  }
  const kind = data?.kind ?? 'flow';
  const slot = data?.outcomeSlot;
  let outcomeStart;
  if (slot && isOutcomeKind(kind)) {
    const p = outcomePortPoint(source, direction, slot.index, slot.count);
    outcomeStart = { x: source.x + p.x, y: source.y + p.y };
  }
  const points = routeFallback({ source, target, kind, direction, outcomeStart, lane: data?.lane });
  return { points, label: labelAnchor(points, direction) };
}

function variantOf(data: AbadaEdgeData | undefined, selected: boolean | undefined): EdgeVariant {
  if (data?.diffKind) return data.diffKind;
  if (data?.isFlowing || data?.isTakenPath) return 'active';
  if (selected || data?.isHighlighted) return 'selected';
  if (data?.kind === 'outcome-error') return 'error';
  if (data?.kind === 'outcome-warn') return 'warn';
  return 'default';
}

export const AbadaEdge = memo(({ id, source, target, data, selected }: EdgeProps<AbadaEdgeType>) => {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const { direction, layout } = useCanvasView();
  const compact = useCompactZoom();
  const variant = variantOf(data, selected);
  const markerEnd = useMarkerUrl(variant);

  if (!sourceNode || !targetNode) return null;

  const route = resolveRoute(id, rectOf(sourceNode), rectOf(targetNode), source, target, data, direction, layout);
  const edgePath = roundedPath(route.points);
  const labelAt = route.label ?? labelAnchor(route.points, direction);

  const kind = data?.kind ?? 'flow';
  const isFlowing = data?.isFlowing;
  const hasToken = data?.hasToken;
  const strokeColor = EDGE_COLORS[variant];
  const strokeWidth = variant === 'default' || variant === 'error' || variant === 'warn' ? 1.75 : 2.5;
  const dash = data?.diffKind === 'removed' ? '6 4' : isOutcomeKind(kind) && !isFlowing ? '5 4' : undefined;
  const opacity = data?.isDimmed ? 0.3 : 1;

  const fullLabel = cleanEdgeLabel(data?.label);
  const shortLabel = truncateLabel(fullLabel);

  return (
    <>
      {isFlowing && (
        <path d={edgePath} fill="none" stroke="#9D4EDD" strokeWidth="6" opacity="0.3" className="blur-xs" />
      )}
      {hasToken && (
        <g>
          <path id={`abada-token-ref-${id}`} d={edgePath} fill="none" stroke="none" pointerEvents="none" />
          <circle r="7" fill="#9D4EDD" opacity="0.3">
            <animateMotion dur={`${TOKEN_DURATION_S}s`} repeatCount="indefinite" begin="0s">
              <mpath href={`#abada-token-ref-${id}`} />
            </animateMotion>
          </circle>
          <circle r="2.5" fill="#EAE3D9">
            <animateMotion dur={`${TOKEN_DURATION_S}s`} repeatCount="indefinite" begin="0s">
              <mpath href={`#abada-token-ref-${id}`} />
            </animateMotion>
          </circle>
        </g>
      )}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray: dash,
          strokeLinejoin: 'round',
          opacity,
          transition: 'opacity 150ms ease-out',
        }}
        className={isFlowing ? 'animate-flow-dash' : ''}
      />
      {fullLabel && (
        <path d={edgePath} fill="none" stroke="transparent" strokeWidth="14">
          <title>{fullLabel}</title>
        </path>
      )}
      {kind === 'default' && (
        <path d={defaultFlowSlash(route.points)} stroke={strokeColor} strokeWidth="1.75" strokeLinecap="round" opacity={opacity} />
      )}

      {data?.diffKind && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelAt.x}px,${labelAt.y + (shortLabel ? 22 : 0)}px)`,
            }}
            className="nodrag nopan pointer-events-none"
          >
            <span
              className="inline-block rounded-full border bg-[#1A1614] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={{ color: strokeColor, borderColor: `${strokeColor}80` }}
            >
              {data.diffKind}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Zoomed out, labels would be unreadable clutter: the full text stays on hover. */}
      {shortLabel && !compact && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelAt.x}px,${labelAt.y}px)`,
              opacity,
            }}
            className="nodrag nopan"
            title={fullLabel !== shortLabel ? fullLabel : undefined}
          >
            <span
              className="block whitespace-nowrap rounded-full border bg-[#1A1614] px-2 py-0.5 font-mono text-[10px] shadow-warm-md"
              style={{
                color: isOutcomeKind(kind) ? strokeColor : '#C9C0B4',
                borderColor: variant === 'default' ? '#3A322E' : `${strokeColor}66`,
              }}
            >
              {shortLabel}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

AbadaEdge.displayName = 'AbadaEdge';
