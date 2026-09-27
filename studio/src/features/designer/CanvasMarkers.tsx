import React from 'react';
import { EDGE_COLORS, type EdgeVariant } from './edgeStyle';

const VARIANTS = Object.keys(EDGE_COLORS) as EdgeVariant[];

/**
 * Arrowhead definitions. Sized in user space (10×8px) so arrows keep the same
 * size whatever the stroke width; the tip sits 1px past the path end, on the
 * target's outline.
 */
export const CanvasMarkers: React.FC<{ prefix: string }> = ({ prefix }) => (
  <svg aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
    <defs>
      {VARIANTS.map((variant) => (
        <marker
          key={variant}
          id={`${prefix}-arrow-${variant}`}
          viewBox="0 0 10 8"
          refX="9"
          refY="4"
          markerWidth="10"
          markerHeight="8"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M 0 0 L 10 4 L 0 8 z" fill={EDGE_COLORS[variant]} />
        </marker>
      ))}
    </defs>
  </svg>
);
