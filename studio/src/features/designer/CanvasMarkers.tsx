import React, { createContext, useContext } from 'react';

/**
 * Visual variants an edge can take. Each variant has its own arrowhead so the
 * arrow always matches the stroke colour of the line it terminates.
 */
export type EdgeVariant =
  | 'default'
  | 'selected'
  | 'active'
  | 'error'
  | 'warn'
  | 'added'
  | 'modified'
  | 'removed';

export const EDGE_COLORS: Record<EdgeVariant, string> = {
  // ~3.9:1 against the #1A1614 canvas: readable without competing with nodes.
  default: '#8A7F74',
  selected: '#EAE3D9',
  active: '#9D4EDD',
  error: '#E76F51',
  warn: '#F4A261',
  added: '#90A955',
  modified: '#F4A261',
  removed: '#E76F51',
};

const VARIANTS = Object.keys(EDGE_COLORS) as EdgeVariant[];

/** Marker ids are scoped per canvas so two flows on one page never share ids. */
const MarkerPrefixContext = createContext('abada-canvas');

export const MarkerPrefixProvider = MarkerPrefixContext.Provider;

export function useMarkerUrl(variant: EdgeVariant): string {
  const prefix = useContext(MarkerPrefixContext);
  return `url(#${prefix}-arrow-${variant})`;
}

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
