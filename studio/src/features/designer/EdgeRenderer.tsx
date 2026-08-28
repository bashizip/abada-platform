import React, { memo } from 'react';
import type { 
  Edge,
  EdgeProps 
} from '@xyflow/react';
import {
  BaseEdge, 
  EdgeLabelRenderer, 
  getBezierPath,
  Position,
} from '@xyflow/react';
import type { DiffChangeKind } from '@/lib/aiDiff/types';

type AbadaEdgeType = Edge<{
  label?: string;
  /** Animated flow dash — token edges, next edges, or dry-run-adjacent edges. */
  isFlowing?: boolean;
  /** Taken execution path — static purple highlight, no animation. */
  isTakenPath?: boolean;
  /** Draws the token dot that arrives into the currently active node. */
  hasToken?: boolean;
  diffKind?: DiffChangeKind | null;
}, 'abadaEdge'>;

/** Duration of one token pass along the edge into the active node. */
const TOKEN_DURATION_S = 1.6;

/**
 * Vertical offset tolerance (px) for treating a forward edge as connecting
 * directly-adjacent rows. Nodes are 128px tall; anything within the top
 * quarter-bands of the target is still "next to" it and reads best as a
 * clean horizontal line. Larger offsets — merging far-apart branch rows —
 * fall back to a bezier so convergence stays visible instead of slashing
 * diagonally across the canvas.
 */
const ADJACENT_ROW_TOLERANCE_PX = 48;

/**
 * Straight-line edge by default: directly adjacent nodes (same row flowing
 * rightwards, or same column flowing downwards) connect with a single clean
 * horizontal/vertical segment, snapped to the source port's level. Any
 * larger offset or backward edge becomes a bezier so branches, loops and
 * convergence stay clearly readable instead of slashing across the canvas.
 */
function buildEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
): { path: string; labelX: number; labelY: number } {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;

  if (Math.abs(dy) <= ADJACENT_ROW_TOLERANCE_PX && dx > 0) {
    return {
      path: `M ${sourceX} ${sourceY} L ${targetX} ${sourceY}`,
      labelX: (sourceX + targetX) / 2,
      labelY: sourceY - 14,
    };
  }

  if (Math.abs(dx) <= ADJACENT_ROW_TOLERANCE_PX && dy > 0) {
    return {
      path: `M ${sourceX} ${sourceY} L ${sourceX} ${targetY}`,
      labelX: sourceX - 14,
      labelY: (sourceY + targetY) / 2,
    };
  }

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return { path, labelX, labelY };
}

export const AbadaEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected
}: EdgeProps<AbadaEdgeType>) => {
  const { path: edgePath, labelX, labelY } = buildEdgePath(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  );

  const isFlowing = data?.isFlowing;
  const isTakenPath = data?.isTakenPath;
  const hasToken = data?.hasToken;
  const diffStroke = data?.diffKind === 'added'
    ? '#90A955'
    : data?.diffKind === 'modified'
      ? '#F4A261'
      : data?.diffKind === 'removed'
        ? '#E76F51'
        : null;
  const strokeColor = diffStroke
    ?? (isFlowing || isTakenPath ? '#9D4EDD' : (selected ? '#F4A261' : '#3A322E'));
  const strokeWidth = isFlowing || isTakenPath || selected || diffStroke ? 3 : 2;

  return (
    <>
      {isFlowing && (
        <path
          d={edgePath}
          fill="none"
          stroke="#9D4EDD"
          strokeWidth="6"
          opacity="0.3"
          className="blur-xs"
        />
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
          ...style,
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray: data?.diffKind === 'removed' ? '6 4' : undefined,
        }}
        className={isFlowing ? 'animate-flow-dash' : ''}
      />
      
      {data?.diffKind && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <span
              className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full border ${
                data.diffKind === 'added'
                  ? 'text-[#90A955] bg-[#1A1614] border-[#90A955]/50'
                  : data.diffKind === 'modified'
                    ? 'text-[#F4A261] bg-[#1A1614] border-[#F4A261]/50'
                    : 'text-[#E76F51] bg-[#1A1614] border-[#E76F51]/50'
              }`}
            >
              {data.diffKind.toUpperCase()}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}

      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY - (data?.diffKind ? 26 : 0)}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <span className="text-[10px] font-mono text-[#A89F91] bg-[#1A1614] px-2 py-0.5 rounded-full border border-[#3A322E] shadow-warm-md whitespace-nowrap">
              {String(data.label)}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

AbadaEdge.displayName = 'AbadaEdge';
