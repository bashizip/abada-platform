import React, { memo } from 'react';
import type { 
  Edge,
  EdgeProps 
} from '@xyflow/react';
import {
  BaseEdge, 
  EdgeLabelRenderer, 
  getBezierPath
} from '@xyflow/react';
import type { DiffChangeKind } from '@/lib/aiDiff/types';

type AbadaEdgeType = Edge<{ label?: string; isFlowing?: boolean; diffKind?: DiffChangeKind | null }, 'abadaEdge'>;

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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isActiveSim = data?.isFlowing;
  const diffStroke = data?.diffKind === 'added'
    ? '#90A955'
    : data?.diffKind === 'modified'
      ? '#F4A261'
      : data?.diffKind === 'removed'
        ? '#E76F51'
        : null;
  const strokeColor = diffStroke ?? (isActiveSim ? '#9D4EDD' : (selected ? '#F4A261' : '#3A322E'));
  const strokeWidth = isActiveSim || selected || diffStroke ? 3 : 2;

  return (
    <>
      {isActiveSim && (
        <path
          d={edgePath}
          fill="none"
          stroke="#9D4EDD"
          strokeWidth="6"
          opacity="0.3"
          className="blur-xs"
        />
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
        className={isActiveSim ? 'animate-flow-dash' : ''} 
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
