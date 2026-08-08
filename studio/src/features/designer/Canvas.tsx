import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  useReactFlow,
  Connection,
  Edge,
  Node,
  BackgroundVariant
} from '@xyflow/react';
import { Bot, Code2, CirclePlay, Workflow } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { AbadaNode } from './NodeRenderer';
import { AbadaEdge } from './EdgeRenderer';
import { autoLayoutWorkflow } from '@/lib/layout/autoLayout';
import { WorkflowNode, WorkflowEdge } from '@/types';

interface CanvasProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onNodeMove: (id: string, x: number, y: number) => void;
  onConnectNodes: (sourceId: string, targetId: string) => void;
  onAutoLayout?: (nodes: WorkflowNode[]) => void;
  onAddNode: (type: WorkflowNode['type']) => void;
  onOpenAplEditor: () => void;
  onFocusPrompt: () => void;
  isSimulating: boolean;
  activeSimulationNodeId: string | null;
}

export const Canvas: React.FC<CanvasProps> = ({
  nodes: rawNodes,
  edges: rawEdges,
  selectedNodeId,
  onSelectNode,
  onNodeMove,
  onConnectNodes,
  onAutoLayout,
  onAddNode,
  onOpenAplEditor,
  onFocusPrompt,
  isSimulating,
  activeSimulationNodeId,
}) => {
  const nodeTypes = useMemo(() => ({
    abadaNode: AbadaNode as any,
  }), []);

  const edgeTypes = useMemo(() => ({
    abadaEdge: AbadaEdge,
  }), []);

  const reactFlowNodes: Node[] = useMemo(() =>
    rawNodes.map(node => ({
      id: node.id,
      type: 'abadaNode',
      position: { x: node.x, y: node.y },
      data: {
        ...node,
        isActiveSim: activeSimulationNodeId === node.id,
        onSelectNode,
      },
      selected: selectedNodeId === node.id
    })),
  [rawNodes, activeSimulationNodeId, selectedNodeId, onSelectNode]);

  const reactFlowEdges: Edge[] = useMemo(() =>
    rawEdges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'abadaEdge',
      data: {
        label: edge.label,
        isFlowing: isSimulating && (activeSimulationNodeId === edge.source || activeSimulationNodeId === edge.target),
      },
      markerEnd: 'url(#arrowhead-saffron)'
    })), [rawEdges, isSimulating, activeSimulationNodeId]);

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target) {
      onConnectNodes(connection.source, connection.target);
    }
  }, [onConnectNodes]);

  const onNodeDragStop = useCallback((event: any, node: Node) => {
    onNodeMove(node.id, node.position.x, node.position.y);
  }, [onNodeMove]);

  const onPaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  return (
    <div className="flex-1 h-full w-full bg-[#1A1614] relative">
      <svg style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0 }}>
        <defs>
          <marker
            id="arrowhead-saffron"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <polygon points="0 0, 8 4, 0 8" fill="#F4A261" />
          </marker>
          <marker
            id="arrowhead-amethyst"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <polygon points="0 0, 8 4, 0 8" fill="#9D4EDD" />
          </marker>
        </defs>
      </svg>

      <ReactFlow
        nodes={reactFlowNodes}
        edges={reactFlowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        fitView
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(168, 159, 145, 0.12)" />
        <AutoLayoutControl
          nodes={rawNodes}
          edges={rawEdges}
          onAutoLayout={onAutoLayout}
        />
      </ReactFlow>

      {rawNodes.length === 0 && (
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

/**
 * Rendered inside <ReactFlow> so useReactFlow can read the store: lays the
 * whole graph out deterministically (ranked left→right) and re-fits the
 * viewport so the readable diagram is immediately visible.
 */
const AutoLayoutControl: React.FC<{
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onAutoLayout?: (nodes: WorkflowNode[]) => void;
}> = ({ nodes, edges, onAutoLayout }) => {
  const { fitView } = useReactFlow();

  const handleAutoLayout = useCallback(() => {
    if (!onAutoLayout) return;
    onAutoLayout(autoLayoutWorkflow(nodes, edges));
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
  }, [nodes, edges, onAutoLayout, fitView]);

  return (
    <Controls showInteractive={false}>
      <ControlButton
        onClick={handleAutoLayout}
        title="Auto Layout — re-layout the diagram as a readable left-to-right flow"
        aria-label="Auto Layout"
      >
        <Workflow className="w-4 h-4" />
      </ControlButton>
    </Controls>
  );
};
