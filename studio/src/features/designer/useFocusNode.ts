import { useEffect, useRef } from 'react';
import type { FlowDirection } from '@/lib/layout/nodeGeometry';
import { duration } from '@/lib/motion';

/** A user pan or zoom this recent keeps the canvas where they put it. */
export const USER_MOVE_GRACE_MS = 4000;
/** Lets the initial fit and layout finish before focusing. */
export const FOCUS_SETTLE_MS = 60;
export const FOCUS_MIN_ZOOM = 0.9;
/** Moves the focus point past the node, towards a card anchored to it. */
export const FOCUS_CARD_OFFSET = 90;

/** The part of the React Flow instance the focus needs. */
export interface FocusViewport {
  getNode: (id: string) => { position: { x: number; y: number }; measured?: { width?: number; height?: number };
    width?: number | null; height?: number | null } | undefined;
  getZoom: () => number;
  setCenter: (x: number, y: number, options: { zoom: number; duration: number }) => unknown;
}

/**
 * Brings a node into view when `focus.key` changes (M5 S4: an incident
 * arrives, or the view opens on one), below centre so a card anchored under
 * it stays visible. It never moves the canvas within a few seconds of the
 * user panning or zooming it. Returns the callback to call on a user move.
 */
export function useFocusNode(
  focus: { nodeId: string; key: string } | null | undefined,
  options: { ready: boolean; direction: FlowDirection; reducedMotion: boolean; viewport: FocusViewport },
): () => void {
  const { ready, direction, reducedMotion, viewport } = options;
  const lastUserMove = useRef(Number.NEGATIVE_INFINITY);
  const viewportRef = useRef(viewport);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  const focusKey = focus?.key;
  const focusNodeId = focus?.nodeId;

  useEffect(() => {
    if (!focusKey || !focusNodeId || !ready) return undefined;
    const timer = window.setTimeout(() => {
      if (Date.now() - lastUserMove.current < USER_MOVE_GRACE_MS) return;
      const { getNode, getZoom, setCenter } = viewportRef.current;
      const node = getNode(focusNodeId);
      if (!node) return;
      const width = node.measured?.width ?? node.width ?? 0;
      const height = node.measured?.height ?? node.height ?? 0;
      const vertical = direction === 'vertical';
      void setCenter(
        node.position.x + width / 2 + (vertical ? FOCUS_CARD_OFFSET : 0),
        node.position.y + height / 2 + (vertical ? 0 : FOCUS_CARD_OFFSET),
        { zoom: Math.max(getZoom(), FOCUS_MIN_ZOOM), duration: reducedMotion ? 0 : duration.base },
      );
    }, FOCUS_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [focusKey, focusNodeId, ready, direction, reducedMotion]);

  return () => { lastUserMove.current = Date.now(); };
}
