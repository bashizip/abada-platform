import { createContext, useContext } from 'react';
import type { EdgeVariant } from './edgeStyle';
import { useStore } from '@xyflow/react';
import type { FlowDirection, Point } from '@/lib/layout/nodeGeometry';
import type { EdgeRoute } from '@/lib/layout/edgeGeometry';

/** Routes from the last auto-layout, valid while nodes stay where it put them. */
export interface CanvasLayoutSnapshot {
  positions: Map<string, Point>;
  routes: Map<string, EdgeRoute>;
}

export interface CanvasView {
  /** Flow axis: drives port sides, outcome markers and outside-label placement. */
  direction: FlowDirection;
  readOnly: boolean;
  layout: CanvasLayoutSnapshot | null;
}

export const CanvasViewContext = createContext<CanvasView>({
  direction: 'horizontal',
  readOnly: true,
  layout: null,
});

export const useCanvasView = (): CanvasView => useContext(CanvasViewContext);

/** Below this zoom, nodes and edges drop secondary detail (semantic zoom). */
export const COMPACT_ZOOM = 0.55;

export const useCompactZoom = (): boolean => useStore((state) => state.transform[2] < COMPACT_ZOOM);

/** Marker ids are scoped per canvas so two flows on one page never share ids. */
const MarkerPrefixContext = createContext('abada-canvas');

export const MarkerPrefixProvider = MarkerPrefixContext.Provider;

export function useMarkerUrl(variant: EdgeVariant): string {
  const prefix = useContext(MarkerPrefixContext);
  return `url(#${prefix}-arrow-${variant})`;
}
