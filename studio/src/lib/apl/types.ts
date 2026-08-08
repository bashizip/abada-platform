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

export type APLNodeType = 'webhook' | 'agent' | 'engine-task' | 'condition' | 'approval-gate' | 'decision-table' | 'end';

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
  profile?: 'abada.agent/v1';
  model?: string;
  prompt?: string;
  inputs?: Record<string, string>;
  result_variable?: string;
  output_schema?: Record<string, unknown>;
  tools?: string[];
  confidence_threshold?: number;
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;
  max_attempts?: number;
  retry_backoff_ms?: number;
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

export type APLHitPolicy = 'FIRST' | 'UNIQUE' | 'COLLECT';

export type APLValue = string | number | boolean;

export interface APLDecisionTableInput {
  name: string;
  expr?: string;
}

export interface APLDecisionTableRule {
  when?: string;
  /** Either a flattened flag (`otherwise: true` + sibling `then`) or the vision's
   *  wrapper form (`otherwise: { then: {...} }`). Both are accepted on parse. */
  otherwise?: boolean | { then: Record<string, APLValue> };
  then?: Record<string, APLValue>;
}

export interface APLDecisionTableNode extends APLBaseNode {
  type: 'decision-table';
  decisionKey?: string;
  hitPolicy?: APLHitPolicy;
  /** Ordered array (studio AST) or the vision's map form (`score: "${...}"`). */
  inputs?: APLDecisionTableInput[] | Record<string, string>;
  rules?: APLDecisionTableRule[];
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
  | APLDecisionTableNode
  | APLApprovalGateNode
  | APLEndNode;
