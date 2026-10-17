import React, { useCallback, useId, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ControlButton,
  Connection,
  ConnectionLineType,
  ConnectionMode,
  Edge,
  Node,
  BackgroundVariant,
  MiniMap,
  NodeToolbar,
  Panel,
  Position,
  ViewportPortal,
  useReactFlow,
} from '@xyflow/react';
import {
  ArrowDownFromLine,
  ArrowRightFromLine,
  Bot,
  Code2,
  CirclePlay,
  Loader2,
  Lock,
  Map as MapIcon,
  Redo2,
  Trash2,
  Undo2,
  Unlock,
  Wand2,
  Workflow,
} from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { canvasNodeTypes, outcomeKindsBySource, toCanvasNode } from './nodes';
import { AbadaEdge, type AbadaEdgeData } from './EdgeRenderer';
import { CanvasMarkers } from './CanvasMarkers';
import { CanvasViewContext, MarkerPrefixProvider, type CanvasView } from './canvasContext';
import { useDiagramLayout } from './useDiagramLayout';
import { NODE_ACCENT, eventAccent } from './nodes/nodeStyle';
import type { CanvasNode } from './nodes';
import { edgeKindOf, outcomeSlots, parallelLanes } from '@/lib/layout/edgeGeometry';
import { type Alignment, alignTo } from '@/lib/layout/alignment';
import type { LayoutMode } from '@/lib/layout/elkLayout';
import { savePreferredLayout, hasSavedLayout } from '@/lib/run/layoutPrefs';
import { playCue } from '@/lib/sound';
import type { NodeRunStatus } from '@/lib/run/liveRun';
import { WorkflowNode, WorkflowEdge, EventSubtype, GatewaySubtype } from '@/types';
import { analyzeLoops } from '@/lib/apl/loopAnalysis';
import type { Route } from '@/lib/apl/routes';
import { ConnectMenu } from './ConnectMenu';
import { palette } from '@/lib/tokens';
import type { PathView } from '@/lib/run/instancePath';
import { usePathArrivals } from './pathArrivals';
import type { RetryPhase } from '@/lib/run/retryPhase';
import { useReducedMotion } from '@/lib/motion';
import { useFocusNode } from './useFocusNode';
import { PathLegend } from './PathLegend';

interface CanvasProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** No node has a saved position yet: run the auto-layout when the canvas opens. */
  layoutPending?: boolean;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onNodeMove: (id: string, x: number, y: number) => void;
  onDeleteNode: (id: string) => void;
  /** A new connection; `route` says what it means (next when omitted). */
  onConnectNodes: (sourceId: string, targetId: string, route?: Route) => void;
  /** Deletes an edge; a route edge also clears the route it stands for. */
  onDeleteEdge?: (edgeId: string) => void;
  /** Engine validation issues per node id (count), shown as node badges. */
  issueCounts?: Map<string, number>;
  /** Receives auto-laid-out nodes on editable canvases (read-only ones keep a local view). */
  onAutoLayout?: (nodes: WorkflowNode[]) => void;
  onAddNode: (type: WorkflowNode['type'], subtype?: EventSubtype | GatewaySubtype) => void;
  onOpenAplEditor: () => void;
  onFocusPrompt: () => void;
  onToast?: (message: string) => void;
  processKey?: string;
  isSimulating: boolean;
  activeSimulationNodeId: string | null;
  executionStatuses?: Record<string, NodeRunStatus>;
  activeLiveNodeIds?: string[];
  /** Edge ids along the instance's taken execution path — rendered as static purple flows. */
  activePathEdges?: string[];
  /**
   * Taken edges entering a currently active node. These get the animated
   * token dot — the current position of the instance.
   */
  activeTokenEdges?: string[];
  /**
   * Edges leaving a currently active node — the possible next steps, rendered
   * with the animated flow dash (no token dot), mirroring the dry run.
   */
  nextPathEdges?: string[];
  /**
   * Instance views: the path taken, where the instance is now and what it
   * never reached. Draws the three path layers and the legend; the untaken
   * part of the diagram fades unless "Show full diagram" is on.
   */
  path?: PathView;
  /** Paced playback (M5 S3): each step the path adds draws its edge and pulses its node once. */
  animateArrivals?: boolean;
  /** Instance views: open incident id per node; a new id pulses the node once (M5 S4). */
  incidentPulses?: Record<string, string>;
  /** Instance views: phase of a retry in progress per node, shown at the playback pace (M5 S4). */
  retryPhases?: Record<string, RetryPhase>;
  /**
   * Brings a node into view. A new `key` pans (and zooms in if needed) to the
   * node, unless the user moved the canvas in the last few seconds.
   */
  focus?: { nodeId: string; key: string } | null;
  /** Content anchored to a node: it follows pan and zoom and stays readable (an incident card). */
  nodeOverlay?: { nodeId: string; content: React.ReactNode } | null;
  readOnly?: boolean;
  /** Document undo/redo (editable canvases only). */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

const edgeTypes = { abadaEdge: AbadaEdge };

const NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const;
const MINIMAP_AUTO_NODES = 12;

const minimapColor = (node: { data: unknown }) => {
  const data = (node as CanvasNode).data;
  return data.type === 'event' ? eventAccent(data.subtype) : NODE_ACCENT[data.type];
};

const isTextInput = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');

export const Canvas: React.FC<CanvasProps> = (props) => (
  <ReactFlowProvider>
    <CanvasInner {...props} />
  </ReactFlowProvider>
);

const CanvasInner: React.FC<CanvasProps> = ({
  nodes: rawNodes,
  edges: rawEdges,
  layoutPending,
  selectedNodeId,
  onSelectNode,
  onNodeMove,
  onDeleteNode,
  onConnectNodes,
  onDeleteEdge,
  issueCounts,
  onAutoLayout,
  onAddNode,
  onOpenAplEditor,
  onFocusPrompt,
  onToast,
  processKey,
  isSimulating,
  activeSimulationNodeId,
  executionStatuses = {},
  activeLiveNodeIds = [],
  activePathEdges = [],
  activeTokenEdges = [],
  nextPathEdges = [],
  path,
  animateArrivals = false,
  incidentPulses,
  retryPhases,
  focus,
  nodeOverlay,
  readOnly = false,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}) => {
  const markerPrefix = `abada-canvas-${useId().replace(/:/g, '')}`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { fitView, setCenter, getNode, getZoom } = useReactFlow();
  const reducedMotion = useReducedMotion();
  const [guides, setGuides] = useState<Alignment | null>(null);
  const [minimapChoice, setMinimapChoice] = useState<boolean | null>(null);
  const showMinimap = minimapChoice ?? rawNodes.length > MINIMAP_AUTO_NODES;

  const layout = useDiagramLayout({
    nodes: rawNodes,
    edges: rawEdges,
    layoutPending,
    onApplyPositions: readOnly ? undefined : onAutoLayout,
    onError: (message) => onToast?.(`Auto-layout failed: ${message}`),
  });

  const view: CanvasView = useMemo(
    () => ({ direction: layout.direction, readOnly, layout: layout.layout }),
    [layout.direction, readOnly, layout.layout],
  );

  const outcomeKinds = useMemo(() => outcomeKindsBySource(rawEdges), [rawEdges]);
  const loops = useMemo(() => analyzeLoops({ nodes: rawNodes, edges: rawEdges }), [rawNodes, rawEdges]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pendingConnect, setPendingConnect] = useState<{ source: string; target: string } | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const slots = useMemo(() => outcomeSlots(rawEdges), [rawEdges]);
  const lanes = useMemo(() => parallelLanes(rawEdges), [rawEdges]);
  const [showFullDiagram, setShowFullDiagram] = useState(false);
  const arrivals = usePathArrivals(path, animateArrivals);

  const reactFlowNodes: Node[] = useMemo(() =>
    layout.displayNodes.map((node) => {
      const visits = path?.visits[node.id];
      const now = path?.now[node.id];
      return toCanvasNode(node, {
        status: executionStatuses[node.id] || 'idle',
        isActiveSim: activeSimulationNodeId === node.id,
        // On an instance path only a running token glows; waiting and incidents have their own ring.
        isLiveCurrent: activeLiveNodeIds.includes(node.id) && (!path || !now || now === 'running'),
        outcomeKinds: outcomeKinds.get(node.id),
        // A loop step shows its bound; a cycle into a step without a usable one is flagged.
        // Instance views show what ran instead of authoring badges.
        loopState: path ? undefined : loops.targets.has(node.id) ? loops.targets.get(node.id) ?? 'bounded'
          : node.loop ? 'bounded' : undefined,
        issueCount: path ? undefined : issueCounts?.get(node.id),
        ...(path ? {
          pathLayer: visits || now ? 'taken' : showFullDiagram ? undefined : 'unreached',
          visitOrders: visits,
          nowState: now,
          join: path.joins[node.id],
          childResults: path.children[node.id],
          pathHint: nodePathHint(path, node.id),
          arrivalSeq: arrivals.nodes.has(node.id) ? arrivals.seq : undefined,
          incidentSeq: incidentPulses?.[node.id],
          retryPhase: retryPhases?.[node.id],
        } : {}),
        selected: selectedNodeId === node.id,
      });
    }),
  [layout.displayNodes, activeSimulationNodeId, activeLiveNodeIds, executionStatuses, selectedNodeId, outcomeKinds,
    loops, issueCounts, path, showFullDiagram, arrivals, incidentPulses, retryPhases]);

  const reactFlowEdges: Edge<AbadaEdgeData>[] = useMemo(() =>
    rawEdges.map(edge => {
      const hasToken = activeTokenEdges.includes(edge.id);
      const isNext = nextPathEdges.includes(edge.id);
      const incident = !!selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId);
      const takenCount = path?.edgeCounts[edge.id];
      const pathLayer = !path ? undefined : takenCount ? 'taken' as const
        : showFullDiagram ? undefined : 'unreached' as const;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'abadaEdge',
        selected: selectedEdgeId === edge.id,
        // The path is drawn above every other edge.
        zIndex: pathLayer === 'taken' ? 1 : 0,
        data: {
          pathLayer,
          takenCount,
          arrivalSeq: arrivals.edges.has(edge.id) ? arrivals.seq : undefined,
          label: edge.label,
          kind: edgeKindOf(edge),
          outcomeSlot: slots.get(edge.id),
          lane: lanes.get(edge.id),
          isTakenPath: activePathEdges.includes(edge.id),
          isFlowing: hasToken || isNext
            || (isSimulating && (activeSimulationNodeId === edge.source || activeSimulationNodeId === edge.target)),
          hasToken,
          isHighlighted: incident || selectedEdgeId === edge.id,
          // Focus: while editing, the selected node's connections stand out.
          isDimmed: !readOnly && !!selectedNodeId && !incident,
        },
      };
    }), [rawEdges, slots, lanes, selectedNodeId, selectedEdgeId, readOnly, isSimulating, activeSimulationNodeId, activePathEdges, activeTokenEdges, nextPathEdges, path, showFullDiagram, arrivals]);

  /**
   * A connection from a task asks what it means (next, error, timeout, an
   * outcome…); from a gateway or an event it is a plain flow.
   */
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const source = rawNodes.find((node) => node.id === connection.source);
    if (source && (source.type === 'agent' || source.type === 'engine-task' || source.type === 'human'
      || source.type === 'call-process')) {
      setPendingConnect({ source: connection.source, target: connection.target });
      playCue('open', { emphasis: 'subtle' });
      return;
    }
    onConnectNodes(connection.source, connection.target);
  }, [onConnectNodes, rawNodes]);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    const bounds = wrapperRef.current?.getBoundingClientRect();
    if (!point || !bounds) return;
    setMenuAt({ x: point.clientX - bounds.left, y: point.clientY - bounds.top });
  }, []);

  const closeMenu = useCallback(() => { setPendingConnect(null); setMenuAt(null); }, []);
  const cancelMenu = useCallback(() => {
    playCue('close', { emphasis: 'subtle' });
    closeMenu();
  }, [closeMenu]);

  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    if (readOnly) return;
    if (selectedEdgeId !== edge.id) playCue('select', { emphasis: 'subtle' });
    setSelectedEdgeId(edge.id);
    onSelectNode(null);
    wrapperRef.current?.focus({ preventScroll: true });
  }, [readOnly, onSelectNode, selectedEdgeId]);

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    const next = alignTo(layout.displayNodes, node.id, node.position);
    setGuides((current) => (current?.guideX === next.guideX && current?.guideY === next.guideY ? current : next));
  }, [layout.displayNodes]);

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    setGuides(null);
    if (readOnly) return;
    const { snapped } = alignTo(layout.displayNodes, node.id, node.position);
    playCue('tap', { emphasis: 'subtle' });
    onNodeMove(node.id, Math.round(snapped.x), Math.round(snapped.y));
  }, [onNodeMove, readOnly, layout.displayNodes]);

  /**
   * Canvas shortcuts (while focus is on the canvas, never in a text field):
   * Shift+L re-applies the current layout mode, Shift+1 fits the view and the
   * arrow keys nudge the selected node (8px, 32px with Shift).
   */
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (isTextInput(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId && !readOnly && onDeleteEdge) {
      event.preventDefault();
      onDeleteEdge(selectedEdgeId);
      setSelectedEdgeId(null);
      return;
    }
    if (event.shiftKey && event.code === 'KeyL') {
      event.preventDefault();
      void layout.runLayout(layout.mode);
      return;
    }
    if (event.shiftKey && event.code === 'Digit1') {
      event.preventDefault();
      void fitView({ padding: 0.15, duration: 200 });
      return;
    }
    const nudge = NUDGE[event.key as keyof typeof NUDGE];
    if (nudge && !readOnly && selectedNodeId) {
      const node = rawNodes.find((n) => n.id === selectedNodeId);
      if (!node) return;
      event.preventDefault();
      const step = event.shiftKey ? 32 : 8;
      onNodeMove(node.id, node.x + nudge[0] * step, node.y + nudge[1] * step);
    }
  }, [layout, fitView, readOnly, selectedNodeId, selectedEdgeId, onDeleteEdge, rawNodes, onNodeMove]);

  const focusCanvas = useCallback(() => wrapperRef.current?.focus({ preventScroll: true }), []);

  /* Brings the focused node into view (an incident arriving), unless the user just moved the canvas. */
  const onUserMove = useFocusNode(focus, {
    ready: layout.ready, direction: layout.direction, reducedMotion, viewport: { getNode, getZoom, setCenter },
  });

  const onNodesDelete = useCallback((deletedNodes: Node[]) => {
    if (readOnly) return;
    deletedNodes.forEach((node) => onDeleteNode(node.id));
  }, [onDeleteNode, readOnly]);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    if (!readOnly && node.id !== selectedNodeId) playCue('select', { emphasis: 'subtle' });
    setSelectedEdgeId(null);
    onSelectNode(node.id);
    focusCanvas();
  }, [onSelectNode, focusCanvas, readOnly, selectedNodeId]);

  const onPaneClick = useCallback(() => {
    setSelectedEdgeId(null);
    onSelectNode(null);
    focusCanvas();
  }, [onSelectNode, focusCanvas]);

  return (
    <div
      ref={wrapperRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="Process diagram"
      className="flex-1 h-full w-full bg-charcoal relative outline-none"
    >
      <CanvasMarkers prefix={markerPrefix} />
      {pendingConnect && menuAt && (() => {
        const source = rawNodes.find((node) => node.id === pendingConnect.source);
        const target = rawNodes.find((node) => node.id === pendingConnect.target);
        return source && target ? (
          <ConnectMenu
            source={source}
            target={target}
            x={menuAt.x}
            y={menuAt.y}
            onCancel={cancelMenu}
            onChoose={(route) => {
              onConnectNodes(source.id, target.id, route);
              closeMenu();
            }}
          />
        ) : null;
      })()}
      <MarkerPrefixProvider value={markerPrefix}>
        <CanvasViewContext.Provider value={view}>
          <ReactFlow
            nodes={reactFlowNodes}
            edges={reactFlowEdges}
            nodeTypes={canvasNodeTypes}
            edgeTypes={edgeTypes}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onEdgeClick={onEdgeClick}
            onNodeClick={onNodeClick}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onNodesDelete={onNodesDelete}
            onPaneClick={onPaneClick}
            onMoveStart={(event) => { if (event) onUserMove(); }}
            connectionMode={ConnectionMode.Loose}
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionLineStyle={{ stroke: palette.saffron, strokeWidth: 2 }}
            deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            maxZoom={2}
            elementsSelectable={!readOnly}
            proOptions={{ hideAttribution: true }}
            className={`transition-opacity duration-150 ${layout.ready ? 'opacity-100' : 'opacity-0'}`}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(168, 159, 145, 0.12)" />
            {guides && <AlignmentGuides guides={guides} />}
            {showMinimap && rawNodes.length > 0 && (
              <MiniMap
                position="bottom-right"
                className={readOnly ? undefined : 'mb-16'}
                pannable
                zoomable
                nodeColor={minimapColor}
                nodeStrokeWidth={0}
                nodeBorderRadius={4}
                maskColor="rgba(26, 22, 20, 0.72)"
                bgColor={palette.mocha}
                style={{ border: `1px solid ${palette.hairline}`, borderRadius: 12, overflow: 'hidden' }}
                ariaLabel="Diagram overview"
              />
            )}
            {(rawNodes.length > 0 || canUndo || canRedo) && (
              <LayoutToolbar
                mode={layout.mode}
                busy={layout.busy}
                onLayout={layout.runLayout}
                showLayout={rawNodes.length > 0}
                history={!readOnly && onUndo && onRedo ? { onUndo, onRedo, canUndo, canRedo } : undefined}
              />
            )}
            {path && (
              <PathLegend
                source={path.source}
                showFullDiagram={showFullDiagram}
                onToggleFullDiagram={() => setShowFullDiagram((value) => !value)}
                raised={showMinimap && rawNodes.length > 0}
              />
            )}
            {nodeOverlay && (
              <NodeToolbar
                nodeId={nodeOverlay.nodeId}
                isVisible
                position={layout.direction === 'vertical' ? Position.Right : Position.Bottom}
                offset={14}
                className="nodrag nopan nowheel"
              >
                {nodeOverlay.content}
              </NodeToolbar>
            )}
            <CanvasControls
              nodes={rawNodes}
              selectedNodeId={selectedNodeId}
              processKey={readOnly ? undefined : processKey}
              readOnly={readOnly}
              showMinimap={showMinimap}
              onToggleMinimap={() => setMinimapChoice(!showMinimap)}
              onDeleteNode={onDeleteNode}
              onToast={onToast}
            />
          </ReactFlow>
        </CanvasViewContext.Provider>
      </MarkerPrefixProvider>

      {rawNodes.length === 0 && !readOnly && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto w-[520px] max-w-[calc(100%-3rem)] rounded-2xl border border-hairline bg-mocha/95 p-6 shadow-warm-lg text-center">
            <div className="mx-auto mb-3 w-10 h-10 rounded-xl bg-saffron/10 border border-saffron/30 flex items-center justify-center">
              <Workflow className="w-5 h-5 text-saffron" />
            </div>
            <h2 className="text-sm font-semibold text-linen">Start with an empty APL process</h2>
            <p className="text-xs text-sand mt-1 mb-5">Choose a visual node, paste canonical YAML, or describe the process in plain language.</p>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => onAddNode('event')}
                className="rounded-xl border border-saffron/30 bg-saffron/10 p-3 text-left hover:border-saffron transition-colors">
                <CirclePlay className="w-4 h-4 text-saffron mb-2" />
                <span className="block text-xs font-semibold">Start node</span>
                <span className="block text-[10px] text-sand mt-1">Build visually</span>
              </button>
              <button onClick={onOpenAplEditor}
                className="rounded-xl border border-mineral-teal/30 bg-mineral-teal/10 p-3 text-left hover:border-mineral-teal transition-colors">
                <Code2 className="w-4 h-4 text-mineral-teal mb-2" />
                <span className="block text-xs font-semibold">Paste APL</span>
                <span className="block text-[10px] text-sand mt-1">YAML editor</span>
              </button>
              <button onClick={onFocusPrompt}
                className="rounded-xl border border-amethyst/30 bg-amethyst/10 p-3 text-left hover:border-amethyst transition-colors">
                <Bot className="w-4 h-4 text-amethyst mb-2" />
                <span className="block text-xs font-semibold">Use prompt</span>
                <span className="block text-[10px] text-sand mt-1">Generate APL</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** What the path says about a node, for its tooltip. */
function nodePathHint(path: PathView, nodeId: string): string | undefined {
  const visits = path.visits[nodeId];
  if (!visits) return path.now[nodeId] === 'incident' ? 'Incident — the instance stopped here' : path.notReached[nodeId];
  const parts = [visits.length > 1 ? `Ran ${visits.length} times — steps ${visits.join(', ')}` : `Step ${visits[0]} of the path`];
  const decided = path.decided[nodeId];
  if (decided?.length) parts.push(`Took ${decided.join(' and ')}`);
  const now = path.now[nodeId];
  if (now === 'running') parts.push('Running now');
  if (now === 'waiting') parts.push('Waiting for a person');
  if (now === 'incident') parts.push('Incident — the instance stopped here');
  if (now === 'ended') parts.push('Finished here');
  return parts.join(' · ');
}

/** Guide lines (flow space) for the centre line a dragged node will snap to. */
const AlignmentGuides: React.FC<{ guides: Alignment }> = ({ guides }) => (
  <ViewportPortal>
    {guides.guideX !== undefined && (
      <div
        className="pointer-events-none absolute left-0 top-0 border-l border-dashed border-saffron/70"
        style={{ transform: `translate(${guides.guideX}px, -10000px)`, height: 20000 }}
      />
    )}
    {guides.guideY !== undefined && (
      <div
        className="pointer-events-none absolute left-0 top-0 border-t border-dashed border-saffron/70"
        style={{ transform: `translate(-10000px, ${guides.guideY}px)`, width: 20000 }}
      />
    )}
  </ViewportPortal>
);

const LAYOUT_BUTTONS: { mode: LayoutMode; label: string; hint: string; Icon: typeof Wand2 }[] = [
  { mode: 'horizontal', label: 'Horizontal', hint: 'Auto-layout left → right, loops routed around the flow (Shift+L repeats)', Icon: ArrowRightFromLine },
  { mode: 'vertical', label: 'Vertical', hint: 'Auto-layout top → bottom, loops routed around the flow (Shift+L repeats)', Icon: ArrowDownFromLine },
  { mode: 'tidy', label: 'Tidy', hint: 'Keep your arrangement: align, space evenly and re-route edges (Shift+L repeats)', Icon: Wand2 },
];

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
const UNDO_HINT = IS_MAC ? 'Undo (⌘Z)' : 'Undo (Ctrl+Z)';
const REDO_HINT = IS_MAC ? 'Redo (⇧⌘Z)' : 'Redo (Ctrl+Y)';

/**
 * Document undo/redo, then the auto-layout modes. The last layout mode used
 * is highlighted and remembered per browser.
 */
const LayoutToolbar: React.FC<{
  mode: LayoutMode;
  busy: boolean;
  onLayout: (mode: LayoutMode) => void;
  showLayout: boolean;
  history?: { onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean };
}> = ({ mode, busy, onLayout, showLayout, history }) => (
  <Panel position="top-left">
    <div
      role="group"
      aria-label="Edit history and auto layout"
      className="flex items-center gap-0.5 rounded-xl border border-hairline bg-mocha/95 p-1 shadow-warm-md"
    >
      {history && (
        <>
          <button type="button" onClick={history.onUndo} disabled={!history.canUndo} title={UNDO_HINT} aria-label="Undo"
            className="flex items-center rounded-lg px-1.5 py-1 text-sand transition-colors hover:bg-mocha-hover hover:text-linen disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-sand">
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" onClick={history.onRedo} disabled={!history.canRedo} title={REDO_HINT} aria-label="Redo"
            className="flex items-center rounded-lg px-1.5 py-1 text-sand transition-colors hover:bg-mocha-hover hover:text-linen disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-sand">
            <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {showLayout && <span className="mx-1 h-4 w-px bg-hairline" aria-hidden="true" />}
        </>
      )}
      {showLayout && (
      <span className="flex w-6 items-center justify-center text-sand" aria-hidden="true">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Workflow className="h-3.5 w-3.5" />}
      </span>
      )}
      {showLayout && LAYOUT_BUTTONS.map(({ mode: value, label, hint, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => onLayout(value)}
          disabled={busy}
          title={hint}
          aria-pressed={mode === value}
          className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-wait ${
            mode === value
              ? 'bg-saffron/15 text-saffron'
              : 'text-sand hover:bg-mocha-hover hover:text-linen'
          }`}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  </Panel>
);

/**
 * Zoom, fit (Shift+1) and overview-map controls, plus the lock-layout and
 * delete-node actions on editable canvases.
 */
const CanvasControls: React.FC<{
  nodes: WorkflowNode[];
  selectedNodeId: string | null;
  processKey?: string;
  readOnly: boolean;
  showMinimap: boolean;
  onToggleMinimap: () => void;
  onDeleteNode: (id: string) => void;
  onToast?: (message: string) => void;
}> = ({ nodes, selectedNodeId, processKey, readOnly, showMinimap, onToggleMinimap, onDeleteNode, onToast }) => {
  const [locked, setLocked] = useState(() => (processKey ? hasSavedLayout(processKey) : false));

  const handleLockLayout = useCallback(() => {
    if (!processKey) return;
    savePreferredLayout(processKey, nodes);
    setLocked(true);
    onToast?.('Layout locked — running instances will use this layout');
  }, [processKey, nodes, onToast]);

  const handleDelete = useCallback(() => {
    if (selectedNodeId) onDeleteNode(selectedNodeId);
  }, [selectedNodeId, onDeleteNode]);

  return (
    <Panel position="bottom-left" className={readOnly ? undefined : 'mb-16'}>
      <Controls showInteractive={false} fitViewOptions={{ padding: 0.15, duration: 200 }}>
        <ControlButton
          onClick={onToggleMinimap}
          title={showMinimap ? 'Hide overview map' : 'Show overview map'}
          aria-label="Toggle overview map"
          aria-pressed={showMinimap}
        >
          <MapIcon className={`w-4 h-4 ${showMinimap ? 'text-saffron' : ''}`} />
        </ControlButton>
        {processKey && (
          <ControlButton
            onClick={handleLockLayout}
            title={locked
              ? 'Layout locked — click to update the saved layout'
              : 'Lock Layout — save current positions for running instances'}
            aria-label="Lock Layout"
          >
            {locked ? <Lock className="w-4 h-4 text-mineral-teal" /> : <Unlock className="w-4 h-4" />}
          </ControlButton>
        )}
        {!readOnly && selectedNodeId && (
          <ControlButton
            onClick={handleDelete}
            title="Delete selected node"
            aria-label="Delete selected node"
          >
            <Trash2 className="w-4 h-4 text-desert-rose" />
          </ControlButton>
        )}
      </Controls>
    </Panel>
  );
};
