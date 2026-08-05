export interface APLDocument {
  version: string;
  metadata: {
    name: string;
    owner?: string;
    category?: string;
  };
  flow: {
    entry: string;
    nodes: APLNode[];
  };
}

export type APLNodeType = 'webhook' | 'agent' | 'engine-task' | 'condition' | 'approval-gate' | 'end';

export interface APLBaseNode {
  id: string;
  type: APLNodeType;
  description?: string;
  next?: string;
  ui?: {
    x: number;
    y: number;
  };
}

export interface APLWebhookNode extends APLBaseNode {
  type: 'webhook';
}

export interface APLAgentNode extends APLBaseNode {
  type: 'agent';
  model?: string;
  prompt?: string;
  tools?: string[];
  confidence_threshold?: number;
}

export interface APLEngineTaskNode extends APLBaseNode {
  type: 'engine-task';
  service: string;
  on_error?: string;
}

export interface APLConditionNode extends APLBaseNode {
  type: 'condition';
  rules: {
    if?: string;
    else?: string;
    then: string;
  }[];
  // Note: condition nodes use 'rules' instead of 'next' for routing
  next?: never; 
}

export interface APLApprovalGateNode extends APLBaseNode {
  type: 'approval-gate';
  assignees: string[];
  mode?: 'parallel' | 'serial';
  sla_hours?: number;
}

export interface APLEndNode extends APLBaseNode {
  type: 'end';
}

export type APLNode =
  | APLWebhookNode
  | APLAgentNode
  | APLEngineTaskNode
  | APLConditionNode
  | APLApprovalGateNode
  | APLEndNode;
