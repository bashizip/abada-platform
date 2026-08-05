import React, { useCallback, useMemo } from 'react';
import { 
  ReactFlow, 
  Background, 
  Controls, 
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  BackgroundVariant
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AbadaNode } from './NodeRenderer';
import { AbadaEdge } from './EdgeRenderer';
import { WorkflowNode, WorkflowEdge, NodeType } from '@/types';

interface CanvasProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onNodeMove: (id: string, x: number, y: number) => void;
  onConnectNodes: (sourceId: string, targetId: string) => void;
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
  isSimulating,
  activeSimulationNodeId
}) => {
  const nodeTypes = useMemo(() => ({
    abadaNode: AbadaNode as any,
  }), []);

  const edgeTypes = useMemo(() => ({
    abadaEdge: AbadaEdge,
  }), []);

  const reactFlowNodes: Node[] = useMemo(() => rawNodes.map(node => ({
    id: node.id,
    type: 'abadaNode',
    position: { x: node.x, y: node.y },
    data: {
      ...node,
      isActiveSim: activeSimulationNodeId === node.id
    },
    selected: selectedNodeId === node.id
  })), [rawNodes, activeSimulationNodeId, selectedNodeId]);

  const reactFlowEdges: Edge[] = useMemo(() => rawEdges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'abadaEdge',
    data: {
      label: edge.label,
      isFlowing: isSimulating && (activeSimulationNodeId === edge.source || activeSimulationNodeId === edge.target)
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

  const onSelectionChange = useCallback((params: { nodes: Node[] }) => {
    if (params.nodes.length > 0) {
      onSelectNode(params.nodes[0].id);
    } else {
      onSelectNode(null);
    }
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
        onSelectionChange={onSelectionChange}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(168, 159, 145, 0.12)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};
