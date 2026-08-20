export interface APLDocument {
  version: string;
  metadata: {
    key?: string;
    name: string;
    owner?: string;
    category?: string;
  };
  flow: {
    entry: string;
    nodes: APLNode[];
  };
}

export type APLNodeType = 'webhook' | 'agent' | 'engine-task' | 'condition' | 'approval-gate' | 'human-input' | 'decision-table' | 'script' | 'inclusive' | 'parallel' | 'event-gateway' | 'message-catch' | 'timer' | 'signal' | 'end';

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

export interface APLInclusiveNode extends APLBaseNode {
  type: 'inclusive';
  /** Fork: every matching `if` rule fires (zero-matches need an explicit
   *  `else` target). A fork never declares `next`. */
  rules?: {
    if?: string;
    else?: string;
    then: string;
  }[];
  /** Join: several upstream nodes converge and it continues via `next`. */
  next?: string;
}

export interface APLParallelNode extends APLBaseNode {
  type: 'parallel';
  /** Fork targets (≥2). A parallel node is a join when upstream nodes converge
   *  on it and it continues via `next`. `branches` and `next` are exclusive. */
  branches?: string[];
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

export interface APLScriptNode extends APLBaseNode {
  type: 'script';
  /** Server-side JavaScript/ECMAScript executed in-transaction by the engine. */
  script: string;
  /** Script engine name; defaults to `javascript`. */
  format?: string;
}

export interface APLApprovalGateNode extends APLBaseNode {
  type: 'approval-gate';
  assignees: string[];
  mode?: 'parallel' | 'serial';
  sla_hours?: number;
  /** Optional form key for task-form rendering (BPMN `camunda:formKey`). */
  formId?: string;
}

export interface APLHumanInputNode extends APLBaseNode {
  type: 'human-input';
  assignees: string[];
  mode?: 'parallel' | 'serial';
  sla_hours?: number;
  /** Optional form key for task-form rendering (BPMN `camunda:formKey`). */
  formId?: string;
}

export interface APLMessageCatchNode extends APLBaseNode {
  type: 'message-catch';
  /** Message name; correlates against the instance variable `correlationKey`. */
  message: string;
}

export interface APLTimerNode extends APLBaseNode {
  type: 'timer';
  /** ISO-8601 duration (duration form only). */
  duration: string;
}

export interface APLSignalNode extends APLBaseNode {
  type: 'signal';
  /** Broadcast signal name. */
  signal: string;
}

/** One competing catch child of an event-gateway node. */
export type APLEventGatewayChild = {
  type: 'message-catch' | 'timer' | 'signal';
  /** Description shown on the compiled BPMN catch event. */
  description?: string;
  /** Message name (message-catch), ISO-8601 duration (timer) or signal name (signal). */
  message?: string;
  duration?: string;
  signal?: string;
  /** Sole successor after this child wins the race. */
  next: string;
};

export interface APLEventGatewayNode extends APLBaseNode {
  type: 'event-gateway';
  /** ≥2 competing catch children; the first to fire wins and the engine
   *  cancels every sibling wait state in the same transaction. Routes via
   *  `events`, never `next`. */
  events: APLEventGatewayChild[];
  next?: never;
}

export interface APLEndNode extends APLBaseNode {
  type: 'end';
}

export type APLNode =
  | APLWebhookNode
  | APLAgentNode
  | APLEngineTaskNode
  | APLConditionNode
  | APLInclusiveNode
  | APLParallelNode
  | APLDecisionTableNode
  | APLApprovalGateNode
  | APLHumanInputNode
  | APLScriptNode
  | APLMessageCatchNode
  | APLTimerNode
  | APLSignalNode
  | APLEventGatewayNode
  | APLEndNode;
