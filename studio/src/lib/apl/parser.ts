import * as yaml from 'yaml';
import dagre from 'dagre';
import { APLDocument, APLNode } from './types';
import { WorkflowFile, WorkflowNode, WorkflowEdge, NodeType, EventSubtype, GatewaySubtype } from '@/types';

/**
 * Parses an APL YAML string into an APLDocument object.
 */
export function parseAPLYaml(yamlString: string): APLDocument {
  return yaml.parse(yamlString) as APLDocument;
}

/**
 * Stringifies an APLDocument object into a YAML string.
 */
export function stringifyAPLYaml(doc: APLDocument): string {
  return yaml.stringify(doc);
}

/**
 * Applies Dagre auto-layout to nodes that don't have x,y coordinates
 */
const applyAutoLayout = (nodes: WorkflowNode[], edges: WorkflowEdge[]) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', align: 'UL', ranksep: 100, nodesep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    // React Flow visual size roughly 200x120
    g.setNode(node.id, { width: 220, height: 120 });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const n = g.node(node.id);
    // Only apply layout if node doesn't have an explicit UI coordinate or if it's 0,0
    if (node.x === 0 && node.y === 0) {
      return { ...node, x: n.x - 110, y: n.y - 60 };
    }
    return node;
  });
};

/**
 * Converts an APLDocument into the internal React Flow WorkflowFile model.
 */
export function aplToWorkflow(apl: APLDocument): WorkflowFile {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  apl.flow.nodes.forEach((aplNode) => {
    let type: NodeType = 'agent';
    let subtype: EventSubtype | GatewaySubtype | undefined = undefined;
    
    const wNode: WorkflowNode = {
      id: aplNode.id,
      type: 'agent',
      title: aplNode.id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: aplNode.description || '',
      x: aplNode.ui?.x || 0,
      y: aplNode.ui?.y || 0,
    };

    switch (aplNode.type) {
      case 'webhook':
        wNode.type = 'event';
        wNode.subtype = 'start';
        break;
      case 'end':
        wNode.type = 'event';
        wNode.subtype = 'end';
        break;
      case 'agent':
        wNode.type = 'agent';
        wNode.agentConfig = {
          model: aplNode.model || 'gemini-3.6-flash',
          systemPrompt: aplNode.prompt || '',
          confidenceThreshold: aplNode.confidence_threshold || 85,
          temperature: 0.2,
          tools: aplNode.tools || [],
        };
        break;
      case 'engine-task':
        wNode.type = 'agent'; // Visual fallback
        wNode.agentConfig = {
          model: 'system-service',
          systemPrompt: `Execute Engine Service: ${aplNode.service}`,
          confidenceThreshold: 100,
          temperature: 0,
          tools: [aplNode.service],
        };
        break;
      case 'approval-gate':
        wNode.type = 'human';
        wNode.humanConfig = {
          assigneeRole: aplNode.assignees?.join(', ') || 'Reviewer',
          slaHours: aplNode.sla_hours || 24,
          formFields: [],
          requireDoubleSignOff: aplNode.mode === 'parallel' && (aplNode.assignees?.length || 0) > 1,
        };
        break;
      case 'condition':
        wNode.type = 'gateway';
        wNode.subtype = 'exclusive';
        wNode.dmnConfig = {
          decisionKey: `RULE_${aplNode.id.toUpperCase()}`,
          hitPolicy: 'FIRST',
          inputs: [],
          outputs: [],
          rules: aplNode.rules.map((r, i) => ({
            id: `r${i}`,
            condition: r.if || r.else || 'true',
            outcome: `Next = ${r.then}`,
          })),
        };
        break;
    }

    nodes.push(wNode);

    // Build edges
    if (aplNode.type === 'condition') {
      aplNode.rules.forEach((r, i) => {
        edges.push({
          id: `e_${aplNode.id}_${r.then}`,
          source: aplNode.id,
          target: r.then,
          label: r.if ? `if ${r.if}` : 'else',
        });
      });
    } else if (aplNode.next) {
      edges.push({
        id: `e_${aplNode.id}_${aplNode.next}`,
        source: aplNode.id,
        target: aplNode.next,
      });
    } else if (aplNode.type === 'engine-task' && aplNode.on_error) {
      edges.push({
        id: `e_${aplNode.id}_${aplNode.on_error}_error`,
        source: aplNode.id,
        target: aplNode.on_error,
        label: 'on_error',
      });
    }
  });

  const layoutedNodes = applyAutoLayout(nodes, edges);

  return {
    id: `wf-${Date.now()}`,
    name: apl.metadata.name,
    category: (apl.metadata.category || 'custom') as any,
    fileType: 'bpmn',
    version: apl.version,
    updatedAt: new Date().toISOString(),
    nodes: layoutedNodes,
    edges,
  };
}

/**
 * Converts internal React Flow WorkflowFile model into an APLDocument.
 */
export function workflowToAPL(wf: WorkflowFile): APLDocument {
  const aplNodes: APLNode[] = [];
  
  // Helper to find outgoing edge target for normal nodes
  const getNextNode = (nodeId: string): string | undefined => {
    const outEdges = wf.edges.filter(e => e.source === nodeId);
    if (outEdges.length > 0 && wf.nodes.find(n => n.id === outEdges[0].target)?.type !== 'gateway') {
      return outEdges[0].target;
    }
    return undefined;
  };

  wf.nodes.forEach(node => {
    const baseNode = {
      id: node.id,
      description: node.description || undefined,
      ui: { x: Math.round(node.x), y: Math.round(node.y) },
    };

    if (node.type === 'event') {
      if (node.subtype === 'start') {
        aplNodes.push({
          ...baseNode,
          type: 'webhook',
          next: getNextNode(node.id),
        } as APLNode);
      } else {
        aplNodes.push({
          ...baseNode,
          type: 'end',
        } as APLNode);
      }
    } else if (node.type === 'agent') {
      aplNodes.push({
        ...baseNode,
        type: 'agent',
        model: node.agentConfig?.model,
        prompt: node.agentConfig?.systemPrompt,
        tools: node.agentConfig?.tools?.length ? node.agentConfig.tools : undefined,
        confidence_threshold: node.agentConfig?.confidenceThreshold,
        next: getNextNode(node.id),
      } as APLNode);
    } else if (node.type === 'human') {
      aplNodes.push({
        ...baseNode,
        type: 'approval-gate',
        assignees: node.humanConfig?.assigneeRole.split(',').map(s => s.trim()) || [],
        mode: node.humanConfig?.requireDoubleSignOff ? 'parallel' : 'serial',
        sla_hours: node.humanConfig?.slaHours,
        next: getNextNode(node.id),
      } as APLNode);
    } else if (node.type === 'gateway') {
      const outEdges = wf.edges.filter(e => e.source === node.id);
      aplNodes.push({
        ...baseNode,
        type: 'condition',
        rules: outEdges.map(e => {
          const isElse = e.label?.toLowerCase().includes('else') || !e.label;
          return {
            if: isElse ? undefined : e.label?.replace('if ', ''),
            else: isElse ? e.target : undefined,
            then: e.target,
          };
        })
      } as APLNode);
    } else if (node.type === 'dmn') {
      // Treat DMN as a generic condition block in APL
      const outEdges = wf.edges.filter(e => e.source === node.id);
      aplNodes.push({
        ...baseNode,
        type: 'condition',
        rules: outEdges.map(e => ({
          if: e.label || 'true',
          then: e.target,
        }))
      } as APLNode);
    }
  });

  const entryNode = wf.nodes.find(n => n.type === 'event' && n.subtype === 'start') || wf.nodes[0];

  return {
    version: 'abada.io/v1',
    metadata: {
      name: wf.name,
      owner: 'studio-user',
      category: wf.category,
    },
    flow: {
      entry: entryNode ? entryNode.id : '',
      nodes: aplNodes,
    }
  };
}
