export type NodeType = 'agent' | 'human' | 'dmn' | 'gateway' | 'event';

export type EventSubtype = 'start' | 'end' | 'timer' | 'message';
export type GatewaySubtype = 'exclusive' | 'parallel' | 'inclusive';

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  confidenceThreshold: number; // 0-100
  temperature: number;
  tools: string[];
  fallbackAction?: 'Escalate to Human' | 'Reroute to Secondary Agent' | 'Reject Payload';
  memoryContext?: string;
}

export interface DMNRule {
  id: string;
  condition: string;
  outcome: string;
  description?: string;
}

export interface DMNConfig {
  decisionKey: string;
  hitPolicy: 'FIRST' | 'UNIQUE' | 'COLLECT' | 'PRIORITY';
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  rules: DMNRule[];
}

export interface HumanConfig {
  assigneeRole: string;
  slaHours: number;
  escalationRole?: string;
  formFields: string[];
  requireDoubleSignOff?: boolean;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  subtype?: EventSubtype | GatewaySubtype;
  title: string;
  description: string;
  x: number;
  y: number;
  status?: 'idle' | 'running' | 'completed' | 'failed' | 'waiting';
  agentConfig?: AgentConfig;
  dmnConfig?: DMNConfig;
  humanConfig?: HumanConfig;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string;
  isActive?: boolean;
}

export interface WorkflowFile {
  id: string;
  name: string;
  category: 'finance' | 'onboarding' | 'claims' | 'supply_chain' | 'custom';
  fileType: 'bpmn' | 'dmn' | 'prompt' | 'json';
  version: string;
  updatedAt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface SimulationLog {
  id: string;
  timestamp: string;
  nodeId: string;
  nodeTitle: string;
  nodeType: NodeType;
  status: 'info' | 'success' | 'warning' | 'error';
  message: string;
  confidence?: number;
  durationMs?: number;
}
