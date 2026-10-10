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
  Panel,
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
import type { NodeRunStatus } from '@/lib/run/liveRun';
import { WorkflowNode, WorkflowEdge, EventSubtype, GatewaySubtype } from '@/types';
import { analyzeLoops } from '@/lib/apl/loopAnalysis';
import type { Route } from '@/lib/apl/routes';
import { ConnectMenu } from './ConnectMenu';

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
  readOnly = false,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}) => {
  const markerPrefix = `abada-canvas-${useId().replace(/:/g, '')}`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();
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

  const reactFlowNodes: Node[] = useMemo(() =>
    layout.displayNodes.map((node) => toCanvasNode(node, {
      status: executionStatuses[node.id] || 'idle',
      isActiveSim: activeSimulationNodeId === node.id,
      isLiveCurrent: activeLiveNodeIds.includes(node.id),
      outcomeKinds: outcomeKinds.get(node.id),
      // A loop step shows its bound; a cycle into a step without a usable one is flagged.
      loopState: loops.targets.has(node.id) ? loops.targets.get(node.id) ?? 'bounded'
        : node.loop ? 'bounded' : undefined,
      issueCount: issueCounts?.get(node.id),
      selected: selectedNodeId === node.id,
    })),
  [layout.displayNodes, activeSimulationNodeId, activeLiveNodeIds, executionStatuses, selectedNodeId, outcomeKinds,
    loops, issueCounts]);

  const reactFlowEdges: Edge<AbadaEdgeData>[] = useMemo(() =>
    rawEdges.map(edge => {
      const hasToken = activeTokenEdges.includes(edge.id);
      const isNext = nextPathEdges.includes(edge.id);
      const incident = !!selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'abadaEdge',
        selected: selectedEdgeId === edge.id,
        data: {
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
    }), [rawEdges, slots, lanes, selectedNodeId, selectedEdgeId, readOnly, isSimulating, activeSimulationNodeId, activePathEdges, activeTokenEdges, nextPathEdges]);

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

  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    if (readOnly) return;
    setSelectedEdgeId(edge.id);
    onSelectNode(null);
    wrapperRef.current?.focus({ preventScroll: true });
  }, [readOnly, onSelectNode]);

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    const next = alignTo(layout.displayNodes, node.id, node.position);
    setGuides((current) => (current?.guideX === next.guideX && current?.guideY === next.guideY ? current : next));
  }, [layout.displayNodes]);

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    setGuides(null);
    if (readOnly) return;
    const { snapped } = alignTo(layout.displayNodes, node.id, node.position);
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

  const onNodesDelete = useCallback((deletedNodes: Node[]) => {
    if (readOnly) return;
    deletedNodes.forEach((node) => onDeleteNode(node.id));
  }, [onDeleteNode, readOnly]);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedEdgeId(null);
    onSelectNode(node.id);
    focusCanvas();
  }, [onSelectNode, focusCanvas]);

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
      className="flex-1 h-full w-full bg-[#1A1614] relative outline-none"
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
            onCancel={closeMenu}
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
            connectionMode={ConnectionMode.Loose}
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionLineStyle={{ stroke: '#F4A261', strokeWidth: 2 }}
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
                bgColor="#25201D"
                style={{ border: '1px solid #3A322E', borderRadius: 12, overflow: 'hidden' }}
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
          <div className="pointer-events-auto w-[520px] max-w-[calc(100%-3rem)] rounded-2xl border border-[#3A322E] bg-[#25201D]/95 p-6 shadow-warm-lg text-center">
            <div className="mx-auto mb-3 w-10 h-10 rounded-xl bg-[#F4A261]/10 border border-[#F4A261]/30 flex items-center justify-center">
              <Workflow className="w-5 h-5 text-[#F4A261]" />
            </div>
            <h2 className="text-sm font-semibold text-[#EAE3D9]">Start with an empty APL process</h2>
            <p className="text-xs text-[#A89F91] mt-1 mb-5">Choose a visual node, paste canonical YAML, or describe the process in plain language.</p>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => onAddNode('event')}
                className="rounded-xl border border-[#F4A261]/30 bg-[#F4A261]/10 p-3 text-left hover:border-[#F4A261] transition-colors">
                <CirclePlay className="w-4 h-4 text-[#F4A261] mb-2" />
                <span className="block text-xs font-semibold">Start node</span>
                <span className="block text-[10px] text-[#A89F91] mt-1">Build visually</span>
              </button>
              <button onClick={onOpenAplEditor}
                className="rounded-xl border border-[#2A9D8F]/30 bg-[#2A9D8F]/10 p-3 text-left hover:border-[#2A9D8F] transition-colors">
                <Code2 className="w-4 h-4 text-[#2A9D8F] mb-2" />
                <span className="block text-xs font-semibold">Paste APL</span>
                <span className="block text-[10px] text-[#A89F91] mt-1">YAML editor</span>
              </button>
              <button onClick={onFocusPrompt}
                className="rounded-xl border border-[#9D4EDD]/30 bg-[#9D4EDD]/10 p-3 text-left hover:border-[#9D4EDD] transition-colors">
                <Bot className="w-4 h-4 text-[#9D4EDD] mb-2" />
                <span className="block text-xs font-semibold">Use prompt</span>
                <span className="block text-[10px] text-[#A89F91] mt-1">Generate APL</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Guide lines (flow space) for the centre line a dragged node will snap to. */
const AlignmentGuides: React.FC<{ guides: Alignment }> = ({ guides }) => (
  <ViewportPortal>
    {guides.guideX !== undefined && (
      <div
        className="pointer-events-none absolute left-0 top-0 border-l border-dashed border-[#F4A261]/70"
        style={{ transform: `translate(${guides.guideX}px, -10000px)`, height: 20000 }}
      />
    )}
    {guides.guideY !== undefined && (
      <div
        className="pointer-events-none absolute left-0 top-0 border-t border-dashed border-[#F4A261]/70"
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
      className="flex items-center gap-0.5 rounded-xl border border-[#3A322E] bg-[#25201D]/95 p-1 shadow-warm-md"
    >
      {history && (
        <>
          <button type="button" onClick={history.onUndo} disabled={!history.canUndo} title={UNDO_HINT} aria-label="Undo"
            className="flex items-center rounded-lg px-1.5 py-1 text-[#A89F91] transition-colors hover:bg-[#2F2926] hover:text-[#EAE3D9] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[#A89F91]">
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" onClick={history.onRedo} disabled={!history.canRedo} title={REDO_HINT} aria-label="Redo"
            className="flex items-center rounded-lg px-1.5 py-1 text-[#A89F91] transition-colors hover:bg-[#2F2926] hover:text-[#EAE3D9] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[#A89F91]">
            <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {showLayout && <span className="mx-1 h-4 w-px bg-[#3A322E]" aria-hidden="true" />}
        </>
      )}
      {showLayout && (
      <span className="flex w-6 items-center justify-center text-[#A89F91]" aria-hidden="true">
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
              ? 'bg-[#F4A261]/15 text-[#F4A261]'
              : 'text-[#A89F91] hover:bg-[#2F2926] hover:text-[#EAE3D9]'
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
          <MapIcon className={`w-4 h-4 ${showMinimap ? 'text-[#F4A261]' : ''}`} />
        </ControlButton>
        {processKey && (
          <ControlButton
            onClick={handleLockLayout}
            title={locked
              ? 'Layout locked — click to update the saved layout'
              : 'Lock Layout — save current positions for running instances'}
            aria-label="Lock Layout"
          >
            {locked ? <Lock className="w-4 h-4 text-[#2A9D8F]" /> : <Unlock className="w-4 h-4" />}
          </ControlButton>
        )}
        {!readOnly && selectedNodeId && (
          <ControlButton
            onClick={handleDelete}
            title="Delete selected node"
            aria-label="Delete selected node"
          >
            <Trash2 className="w-4 h-4 text-[#E76F51]" />
          </ControlButton>
        )}
      </Controls>
    </Panel>
  );
};
