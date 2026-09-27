import React, { useCallback, useId, useMemo, useState } from 'react';
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
  Panel
} from '@xyflow/react';
import {
  ArrowDownFromLine,
  ArrowRightFromLine,
  Bot,
  Code2,
  CirclePlay,
  Loader2,
  Lock,
  Trash2,
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
import { edgeKindOf, outcomeSlots, parallelLanes } from '@/lib/layout/edgeGeometry';
import type { LayoutMode } from '@/lib/layout/elkLayout';
import { savePreferredLayout, hasSavedLayout } from '@/lib/run/layoutPrefs';
import type { NodeRunStatus } from '@/lib/run/liveRun';
import { WorkflowNode, WorkflowEdge, EventSubtype, GatewaySubtype } from '@/types';

interface CanvasProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** No node has a saved position yet: run the auto-layout when the canvas opens. */
  layoutPending?: boolean;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onNodeMove: (id: string, x: number, y: number) => void;
  onDeleteNode: (id: string) => void;
  onConnectNodes: (sourceId: string, targetId: string) => void;
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
}

const edgeTypes = { abadaEdge: AbadaEdge };

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
}) => {
  const markerPrefix = `abada-canvas-${useId().replace(/:/g, '')}`;

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
  const slots = useMemo(() => outcomeSlots(rawEdges), [rawEdges]);
  const lanes = useMemo(() => parallelLanes(rawEdges), [rawEdges]);

  const reactFlowNodes: Node[] = useMemo(() =>
    layout.displayNodes.map((node) => toCanvasNode(node, {
      status: executionStatuses[node.id] || 'idle',
      isActiveSim: activeSimulationNodeId === node.id,
      isLiveCurrent: activeLiveNodeIds.includes(node.id),
      outcomeKinds: outcomeKinds.get(node.id),
      selected: selectedNodeId === node.id,
    })),
  [layout.displayNodes, activeSimulationNodeId, activeLiveNodeIds, executionStatuses, selectedNodeId, outcomeKinds]);

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
        data: {
          label: edge.label,
          kind: edgeKindOf(edge),
          outcomeSlot: slots.get(edge.id),
          lane: lanes.get(edge.id),
          isTakenPath: activePathEdges.includes(edge.id),
          isFlowing: hasToken || isNext
            || (isSimulating && (activeSimulationNodeId === edge.source || activeSimulationNodeId === edge.target)),
          hasToken,
          isHighlighted: incident,
          // Focus: while editing, the selected node's connections stand out.
          isDimmed: !readOnly && !!selectedNodeId && !incident,
        },
      };
    }), [rawEdges, slots, lanes, selectedNodeId, readOnly, isSimulating, activeSimulationNodeId, activePathEdges, activeTokenEdges, nextPathEdges]);

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target) {
      onConnectNodes(connection.source, connection.target);
    }
  }, [onConnectNodes]);

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    if (!readOnly) onNodeMove(node.id, node.position.x, node.position.y);
  }, [onNodeMove, readOnly]);

  const onNodesDelete = useCallback((deletedNodes: Node[]) => {
    if (readOnly) return;
    deletedNodes.forEach((node) => onDeleteNode(node.id));
  }, [onDeleteNode, readOnly]);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    onSelectNode(node.id);
  }, [onSelectNode]);

  const onPaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  return (
    <div className="flex-1 h-full w-full bg-[#1A1614] relative">
      <CanvasMarkers prefix={markerPrefix} />
      <MarkerPrefixProvider value={markerPrefix}>
        <CanvasViewContext.Provider value={view}>
          <ReactFlow
            nodes={reactFlowNodes}
            edges={reactFlowEdges}
            nodeTypes={canvasNodeTypes}
            edgeTypes={edgeTypes}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
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
            {rawNodes.length > 0 && (
              <LayoutToolbar mode={layout.mode} busy={layout.busy} onLayout={layout.runLayout} />
            )}
            <CanvasControls
              nodes={rawNodes}
              selectedNodeId={selectedNodeId}
              processKey={readOnly ? undefined : processKey}
              readOnly={readOnly}
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

const LAYOUT_BUTTONS: { mode: LayoutMode; label: string; hint: string; Icon: typeof Wand2 }[] = [
  { mode: 'horizontal', label: 'Horizontal', hint: 'Auto-layout left → right, loops routed around the flow', Icon: ArrowRightFromLine },
  { mode: 'vertical', label: 'Vertical', hint: 'Auto-layout top → bottom, loops routed around the flow', Icon: ArrowDownFromLine },
  { mode: 'tidy', label: 'Tidy', hint: 'Keep your arrangement: align, space evenly and re-route edges', Icon: Wand2 },
];

/** Auto-layout modes. The last mode used is highlighted and remembered per browser. */
const LayoutToolbar: React.FC<{
  mode: LayoutMode;
  busy: boolean;
  onLayout: (mode: LayoutMode) => void;
}> = ({ mode, busy, onLayout }) => (
  <Panel position="top-left">
    <div
      role="group"
      aria-label="Auto layout"
      className="flex items-center gap-0.5 rounded-xl border border-[#3A322E] bg-[#25201D]/95 p-1 shadow-warm-md"
    >
      <span className="flex w-6 items-center justify-center text-[#A89F91]" aria-hidden="true">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Workflow className="h-3.5 w-3.5" />}
      </span>
      {LAYOUT_BUTTONS.map(({ mode: value, label, hint, Icon }) => (
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
 * Zoom and fit controls, plus the lock-layout and delete-node actions on
 * editable canvases.
 */
const CanvasControls: React.FC<{
  nodes: WorkflowNode[];
  selectedNodeId: string | null;
  processKey?: string;
  readOnly: boolean;
  onDeleteNode: (id: string) => void;
  onToast?: (message: string) => void;
}> = ({ nodes, selectedNodeId, processKey, readOnly, onDeleteNode, onToast }) => {
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
      <Controls showInteractive={false}>
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
