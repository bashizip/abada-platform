export type NodeType = 'agent' | 'human' | 'dmn' | 'gateway' | 'event' | 'engine-task' | 'script';

export type EventSubtype = 'start' | 'end' | 'timer' | 'message' | 'signal';
export type GatewaySubtype = 'exclusive' | 'parallel' | 'inclusive';

export interface AgentConfig {
  profileVersion?: 'abada.agent/v1';
  model: string;
  systemPrompt: string;
  confidenceThreshold: number; // 0-100
  temperature: number;
  tools: string[];
  fallbackAction?: 'Escalate to Human' | 'Reroute to Secondary Agent' | 'Reject Payload';
  memoryContext?: string;
  inputs?: Record<string, string>;
  resultVariable?: string;
  outputSchema?: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
}

export type DMNValue = string | number | boolean;

export interface DMNInput {
  name: string;
  type?: string;
  /** Expression the engine evaluates to resolve this input, e.g. `${extract_data.credit_score}`. */
  expr?: string;
}

export interface DMNRule {
  id: string;
  /** Deterministic condition evaluated against the decision-table inputs, e.g. `score >= 750 and income >= 60000`. */
  when?: string;
  /** Marks the fallback rule applied when no `when` rule matches. */
  otherwise?: boolean;
  /** Outputs produced by this rule, e.g. `{ risk_level: 'LOW', auto_approve: true }`. */
  then: Record<string, DMNValue>;
  description?: string;
}

export interface DMNConfig {
  decisionKey: string;
  /** Values the engine can execute: FIRST (default), UNIQUE, COLLECT. */
  hitPolicy: 'FIRST' | 'UNIQUE' | 'COLLECT';
  inputs: DMNInput[];
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

export interface EngineTaskConfig {
  /** External-task topic the engine publishes for this activity. */
  service: string;
  /** Error-handling flow target, emitted as an `on_error` edge. */
  onError?: string;
}

export interface ScriptConfig {
  /** Server-side JavaScript/ECMAScript executed inside the workflow transaction. */
  script: string;
  /** Engine script engine name; defaults to `javascript`. */
  format?: string;
}

export interface CatchEventConfig {
  /** Message name (`message-catch`), ISO-8601 duration (`timer`) or signal name (`signal`). */
  definitionRef: string;
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
  engineTaskConfig?: EngineTaskConfig;
  scriptConfig?: ScriptConfig;
  catchEventConfig?: CatchEventConfig;
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
  fileType: 'apl' | 'bpmn' | 'dmn' | 'prompt' | 'json';
  version: string;
  updatedAt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Active APL language spec version, e.g. `abada.io/v1`. */
  languageVersion?: string;
  /** Original format when this APL document was converted on import. */
  importedFrom?: 'BPMN';
  /** Stable project-local process identity (`metadata.key`). */
  processKey?: string;
  /** PostgreSQL-backed Studio document identity and optimistic revision. */
  documentId?: string;
  revision?: number;
  description?: string;
  /** Project file-tree location: target folder id and file name. */
  folderId?: string;
  fileName?: string;
}

export const LANGUAGE_VERSION_ABADA_IO_V1 = 'abada.io/v1';

export const isAplNativeFormat = (fileType: WorkflowFile['fileType']): boolean =>
  fileType === 'apl';

export const getFileFormatLabel = (fileType: WorkflowFile['fileType']): string => {
  switch (fileType) {
    case 'apl':
      return '.apl.yaml';
    case 'bpmn':
      return '.bpmn';
    default:
      return `.${fileType}`;
  }
};

export const getRuntimeStatusTag = (fileType: WorkflowFile['fileType']): 'APL Native' | 'BPMN Imported' =>
  isAplNativeFormat(fileType) ? 'APL Native' : 'BPMN Imported';

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
  /** Decision-table outputs written by the engine in-transaction (name = value). */
  outputs?: { name: string; value: string }[];
}
