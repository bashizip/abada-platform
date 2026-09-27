import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { WorkflowEdge, WorkflowNode } from '@/types';
import {
  type LayoutMode,
  type LayoutResult,
  applyPositions,
  computeLayout,
  matchesPositions,
} from '@/lib/layout/elkLayout';
import { inferDirection } from '@/lib/layout/edgeGeometry';
import type { FlowDirection, Point } from '@/lib/layout/nodeGeometry';
import { getPreferredLayoutMode, setPreferredLayoutMode } from '@/lib/run/layoutPrefs';
import type { CanvasLayoutSnapshot } from './canvasContext';

interface Options {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** The process has no saved positions: lay it out as soon as the canvas opens. */
  layoutPending?: boolean;
  /**
   * Editable canvases persist layout positions through this callback (they
   * become the APL `ui` hints). Read-only canvases omit it and keep the
   * positions as a local view override.
   */
  onApplyPositions?: (nodes: WorkflowNode[]) => void;
  onError?: (message: string) => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Owns the canvas auto-layout: the ELK run per mode, the routes it produced
 * (kept in memory, never persisted) and the initial layout of processes
 * without saved positions. Must be used inside a ReactFlowProvider.
 */
export function useDiagramLayout({ nodes, edges, layoutPending, onApplyPositions, onError }: Options) {
  const { fitView } = useReactFlow();
  const [mode, setMode] = useState<LayoutMode>(getPreferredLayoutMode);
  const [result, setResult] = useState<LayoutResult | null>(null);
  const [override, setOverride] = useState<Map<string, Point> | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const runSeq = useRef(0);

  const displayNodes = useMemo(
    () => (override ? applyPositions(nodes, override) : nodes),
    [nodes, override],
  );

  // Latest values for the async callbacks without re-creating them per render.
  const latest = useRef({ displayNodes, edges, onApplyPositions, onError });
  latest.current = { displayNodes, edges, onApplyPositions, onError };

  // Fit once the laid-out positions have actually reached React Flow, i.e.
  // after the render that carries them (the parent applies them async).
  const fitPending = useRef(false);
  const fit = useCallback(() => {
    fitPending.current = true;
  }, []);
  useEffect(() => {
    if (!fitPending.current) return;
    fitPending.current = false;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.15, duration: prefersReducedMotion() ? 0 : 300 });
    });
    return () => cancelAnimationFrame(frame);
  }, [displayNodes, fitView]);

  const runLayout = useCallback(async (next: LayoutMode) => {
    const seq = ++runSeq.current;
    const { displayNodes: current, edges: currentEdges } = latest.current;
    setBusy(true);
    try {
      const laid = await computeLayout(current, currentEdges, next);
      if (seq !== runSeq.current) return;
      setResult(laid);
      setMode(next);
      setPreferredLayoutMode(next);
      const { onApplyPositions: apply } = latest.current;
      if (apply) apply(applyPositions(current, laid.positions));
      else setOverride(laid.positions);
      fit();
    } catch (error) {
      if (seq !== runSeq.current) return;
      setFailed(true);
      latest.current.onError?.(error instanceof Error ? error.message : 'Auto-layout failed');
    } finally {
      if (seq === runSeq.current) setBusy(false);
    }
  }, [fit]);

  // First open: lay out processes without saved positions; for the others,
  // recover the layout's routes when the saved positions are exactly what the
  // (deterministic) layout produces, i.e. nobody moved a node since.
  const reconciled = useRef(false);
  useEffect(() => {
    if (layoutPending) {
      void runLayout(mode === 'tidy' ? 'horizontal' : mode);
      return;
    }
    if (reconciled.current || result) return;
    reconciled.current = true;
    const { displayNodes: current, edges: currentEdges } = latest.current;
    if (current.length === 0) return;
    const direction = inferDirection(current, currentEdges);
    const seq = runSeq.current;
    computeLayout(current, currentEdges, direction)
      .then((laid) => {
        if (seq === runSeq.current && matchesPositions(latest.current.displayNodes, laid.positions)) setResult(laid);
      })
      .catch(() => undefined);
    // Only on open and when a layout is requested; later edits keep their routes until re-laid-out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutPending]);

  const direction: FlowDirection = result?.direction ?? inferDirection(displayNodes, edges);
  const snapshot: CanvasLayoutSnapshot | null = useMemo(
    () => (result ? { positions: result.positions, routes: result.routes } : null),
    [result],
  );

  return {
    displayNodes,
    direction,
    layout: snapshot,
    mode,
    busy,
    /** False while a pending first layout is still running (the canvas stays hidden). */
    ready: !layoutPending || !!override || !!result || failed,
    runLayout,
  };
}
