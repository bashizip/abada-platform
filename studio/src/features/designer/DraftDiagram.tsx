import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  type Edge,
  type Node,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowEdge, WorkflowNode } from '@/types';
import type { DiffChangeKind } from '@/lib/aiDiff/types';
import { canvasNodeTypes, outcomeKindsBySource, toCanvasNode } from './nodes';
import { AbadaEdge } from './EdgeRenderer';
import { CanvasMarkers } from './CanvasMarkers';
import { CanvasViewContext, MarkerPrefixProvider, type CanvasView } from './canvasContext';
import { edgeKindOf, inferDirection, outcomeSlots, parallelLanes } from '@/lib/layout/edgeGeometry';
import { type LayoutResult, applyPositions, computeLayout } from '@/lib/layout/elkLayout';
import { duration, useReducedMotion } from '@/lib/motion';

export interface DraftDiagramProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeDiffKind?: (nodeId: string) => DiffChangeKind | null;
  nodeDiffAnnotation?: (nodeId: string) => string | undefined;
  edgeDiffKind?: (edgeId: string) => DiffChangeKind | null;
  /** Engine validation issues per node, badged on the nodes. */
  issueCounts?: Map<string, number>;
  /** Makes nodes selectable; called with the node id, or null when the pane is clicked. */
  onSelectNode?: (nodeId: string | null) => void;
  selectedNodeId?: string | null;
  /**
   * Animates successive versions of the graph (M5 S12): nodes that stay glide to their new
   * place, added ones fade in, removed ones fade out. Off: each version simply replaces the last.
   */
  animateChanges?: boolean;
}

const edgeTypes = { abadaEdge: AbadaEdge };
const NO_NODES: WorkflowNode[] = [];
const NO_EDGES: WorkflowEdge[] = [];

/** Fits the view whenever the laid-out graph changes; kept inside ReactFlow for its context. */
const FitOnChange: React.FC<{ signature: string; animate: boolean }> = ({ signature, animate }) => {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!signature) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.15, duration: animate ? duration.base : 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [signature, animate, fitView]);
  return null;
};

/**
 * A read-only rendering of a process with the real canvas nodes and edges, auto-laid-out with ELK
 * for reading (nothing is saved from here). Shared by the Insight review and the AI draft workspace.
 */
export const DraftDiagram: React.FC<DraftDiagramProps> = ({
  nodes,
  edges,
  nodeDiffKind,
  nodeDiffAnnotation,
  edgeDiffKind,
  issueCounts,
  onSelectNode,
  selectedNodeId,
  animateChanges = false,
}) => {
  const reduced = useReducedMotion();
  const markerPrefix = `abada-draft-${useId().replace(/:/g, '')}`;
  const [laid, setLaid] = useState<LayoutResult | null>(null);
  const [laidFor, setLaidFor] = useState<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] } | null>(null);
  useEffect(() => {
    let live = true;
    computeLayout(nodes, edges, inferDirection(nodes, edges))
      .then((result) => { if (live) { setLaid(result); setLaidFor({ nodes, edges }); } })
      .catch(() => { if (live) { setLaid(null); setLaidFor({ nodes, edges }); } });
    return () => { live = false; };
  }, [nodes, edges]);

  // Until the new layout is ready the previous version stays on screen, so nodes move once, to
  // their final place, instead of jumping to their raw coordinates first.
  const shownNodes = useMemo(() => laidFor?.nodes ?? (animateChanges ? NO_NODES : nodes), [laidFor, animateChanges, nodes]);
  const shownEdges = useMemo(() => laidFor?.edges ?? (animateChanges ? NO_EDGES : edges), [laidFor, animateChanges, edges]);

  // Nodes of the previous version that this one removed: kept briefly so they can fade out.
  const previous = useRef<Map<string, Node>>(new Map());
  const [exiting, setExiting] = useState<Node[]>([]);
  const firstVersion = useRef(true);

  const view: CanvasView = useMemo(
    () => ({
      direction: laid?.direction ?? inferDirection(shownNodes, shownEdges),
      readOnly: true,
      layout: laid ? { positions: laid.positions, routes: laid.routes } : null,
    }),
    [laid, shownNodes, shownEdges],
  );

  const graphNodes: Node[] = useMemo(() => {
    const outcomeKinds = outcomeKindsBySource(shownEdges);
    const placed = laid ? applyPositions(shownNodes, laid.positions) : shownNodes;
    return placed.map((node) => {
      const diffKind = nodeDiffKind?.(node.id) ?? null;
      const isNew = animateChanges && !firstVersion.current && !previous.current.has(node.id);
      return {
        ...toCanvasNode(node, {
          isActiveSim: false,
          diffKind,
          diffAnnotation: diffKind ? nodeDiffAnnotation?.(node.id) : undefined,
          outcomeKinds: outcomeKinds.get(node.id),
          issueCount: issueCounts?.get(node.id),
          selectable: !!onSelectNode,
          selected: onSelectNode ? node.id === selectedNodeId : undefined,
        }),
        className: isNew ? 'abada-draft-enter' : undefined,
      };
    });
  }, [shownNodes, shownEdges, laid, nodeDiffKind, nodeDiffAnnotation, issueCounts, onSelectNode, selectedNodeId,
    animateChanges]);

  // After a version is shown, remember its nodes; the ones that disappeared fade out for one beat.
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!laidFor) return;
    const next = new Map(graphNodes.map((node) => [node.id, node]));
    if (animateChanges && !firstVersion.current) {
      const gone = [...previous.current.values()]
        .filter((node) => !next.has(node.id))
        .map((node) => ({ ...node, className: 'abada-draft-exit', selectable: false, selected: false }));
      const moved = graphNodes.some((node) => {
        const old = previous.current.get(node.id);
        return old && (old.position.x !== node.position.x || old.position.y !== node.position.y);
      });
      setExiting(gone);
      setMoving(moved);
      const timer = window.setTimeout(() => { setExiting([]); setMoving(false); }, duration.base + 40);
      previous.current = next;
      return () => window.clearTimeout(timer);
    }
    previous.current = next;
    firstVersion.current = false;
    return undefined;
    // Only a new laid-out version starts a transition; selection and badges do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laidFor]);

  const graphEdges: Edge[] = useMemo(() => {
    const slots = outcomeSlots(shownEdges);
    const lanes = parallelLanes(shownEdges);
    return shownEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'abadaEdge',
      data: {
        label: edge.label,
        kind: edgeKindOf(edge),
        outcomeSlot: slots.get(edge.id),
        lane: lanes.get(edge.id),
        isFlowing: false,
        diffKind: edgeDiffKind?.(edge.id) ?? null,
      },
    }));
  }, [shownEdges, edgeDiffKind]);

  const signature = laidFor ? `${shownNodes.map((n) => n.id).join(',')}|${laid ? 'laid' : 'raw'}` : '';
  const classes = [
    'abada-draft-diagram h-full w-full',
    animateChanges && !reduced ? 'abada-draft-glide' : '',
    moving ? 'abada-draft-moving' : '',
  ].join(' ');

  return (
    <div className={classes} data-testid="draft-diagram">
      <CanvasMarkers prefix={markerPrefix} />
      <MarkerPrefixProvider value={markerPrefix}>
        <CanvasViewContext.Provider value={view}>
          <ReactFlow
            nodes={exiting.length ? [...graphNodes, ...exiting] : graphNodes}
            edges={graphEdges}
            nodeTypes={canvasNodeTypes}
            connectionMode={ConnectionMode.Loose}
            edgeTypes={edgeTypes}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={!!onSelectNode}
            onNodeClick={onSelectNode ? (_, node) => onSelectNode(node.id) : undefined}
            onPaneClick={onSelectNode ? () => onSelectNode(null) : undefined}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(168, 159, 145, 0.12)" />
            <FitOnChange signature={signature} animate={animateChanges && !reduced} />
          </ReactFlow>
        </CanvasViewContext.Provider>
      </MarkerPrefixProvider>
    </div>
  );
};
