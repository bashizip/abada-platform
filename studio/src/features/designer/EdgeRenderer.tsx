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

type AbadaEdgeType = Edge<{ label?: string; isFlowing?: boolean }, 'abadaEdge'>;

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
  const strokeColor = isActiveSim ? '#9D4EDD' : (selected ? '#F4A261' : '#3A322E');
  const strokeWidth = isActiveSim || selected ? 3 : 2;

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
        }} 
        className={isActiveSim ? 'animate-flow-dash' : ''} 
      />
      
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
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
