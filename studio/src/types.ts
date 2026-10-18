import type { APLAgentNode, Delegates, VariableDeclaration } from './lib/apl/types.generated';

/** One process an agent may delegate to (`delegates`, E20b). */
export type AgentDelegate = Delegates[number];

export type NodeType = 'agent' | 'human' | 'dmn' | 'gateway' | 'event' | 'engine-task' | 'script' | 'call-process';

export type EventSubtype = 'start' | 'end' | 'timer' | 'message' | 'signal';
export type GatewaySubtype = 'exclusive' | 'parallel' | 'inclusive' | 'event';

/** A node's `on_error` route: one target, or targets per BPMN error code (a rule without code catches the rest). */
export type OnErrorRoute = string | { code?: string; then: string }[];

/** One reviewer decision of a human task: where it leads and whether it needs a comment. */
export interface ReviewOutcome {
  next: string;
  comment?: 'required' | 'optional';
}

/** One next step a routing agent may choose (`routes`): the engine checks the choice and its `when`. */
export interface AgentRoute {
  next: string;
  /** What the route means; the agent chooses by it. */
  description: string;
  /** Optional CEL condition over the instance variables and the agent's result; false vetoes the route. */
  when?: string;
}

/** An interrupting timeout boundary (`on_timeout`): after the ISO-8601 duration the step's work is cancelled. */
export interface OnTimeoutRoute {
  after: string;
  then: string;
}

/** One entry of an agent's `tools:` list, exactly as APL accepts it. */
export type AgentToolRef = NonNullable<APLAgentNode['tools']>[number];

/** The `<server>/<tool>` reference (or advisory name) of a tools entry. */
export const toolRefOf = (tool: AgentToolRef): string => (typeof tool === 'string' ? tool : tool.ref);

export interface AgentConfig {
  profileVersion?: 'abada.agent/v1';
  model: string;
  systemPrompt: string;
  /** 0-100; 0 means no threshold. The engine enforces it against the model's `_confidence`. */
  confidenceThreshold: number;
  temperature: number;
  /** `<server>/<tool>` refs (or `{ ref, policy }` tightening the server's policy); bare names are advisory. */
  tools: AgentToolRef[];
  /** Target node when `_confidence` is missing or below the threshold (`on_low_confidence`). */
  onLowConfidence?: string;
  /** Target node when the output violates `output_schema` (`on_invalid_output`). */
  onInvalidOutput?: string;
  /** Target(s) when the worker reports an error or the last attempt fails (`on_error`). */
  onError?: OnErrorRoute;
  /** Where the flow continues when the step is not done in time (`on_timeout`). */
  onTimeout?: OnTimeoutRoute;
  /** Models tried in order when the model before is unavailable (`fallback_models`). */
  fallbackModels?: string[];
  /** Model calls per attempt (`max_turns`, 1–32). */
  maxTurns?: number;
  /** Tokens for the whole task across attempts (`max_tokens_total`). */
  maxTokensTotal?: number;
  /** Engine-computed spend cap for the whole task, in USD (`budget_usd`). */
  budgetUsd?: number;
  /** Processes the agent may start as governed children (`delegates`). */
  delegates?: AgentDelegate[];
  /** The review step that checks this agent's output and the outcome that keeps it (`reviewed_by`, E14). */
  reviewedBy?: { node: string; accept: string };
  /** Next steps the agent chooses from (`routes`); a node with routes has no `next`. */
  routes?: Record<string, AgentRoute>;
  inputs?: Record<string, string>;
  resultVariable?: string;
  outputSchema?: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
  /** What the step journal keeps of this agent's payloads; only stricter than the project policy (`evidence`). */
  evidence?: AgentEvidence;
}

export interface AgentEvidence {
  payloads?: 'none' | 'redacted' | 'full';
  /** Days the journal keeps the payloads (`retention_days`). */
  retentionDays?: number;
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
  /**
   * The APL block: `human-input` (default) or the deprecated `approval-gate` alias, kept as written so
   * saving never rewrites it; the panel offers the conversion.
   */
  kind?: 'human-input' | 'approval-gate';
  assignees: string[];
  /** Authoring hint for several assignees (`mode`); the engine does not enforce it. */
  mode?: 'serial' | 'parallel';
  /** Service level in hours: the engine escalates the open task in place when it is missed. */
  slaHours?: number;
  /** Groups added as candidates when the task is escalated (`escalate_to`). */
  escalateTo?: string[];
  /** Route when the task is failed (`on_error`). */
  onError?: OnErrorRoute;
  /** Where the flow continues when the task is not done in time (`on_timeout`). */
  onTimeout?: OnTimeoutRoute;
  /** Decisions a reviewer chooses from (`outcomes`); each has its own exit and comment rule. */
  outcomes?: Record<string, ReviewOutcome>;
  /** Optional form key for task-form rendering (BPMN `camunda:formKey`). */
  formKey?: string;
  formFields: string[];
}

/**
 * A `call-process` node: a governed child instance of `process` (same project,
 * version pinned when this process is deployed). `inputs`, `outputs` and
 * `max_depth` are kept verbatim; editing them comes with the designer work.
 */
export interface CallProcessConfig {
  process: string;
  /** Child variable → CEL expression over the parent's variables. */
  inputs?: Record<string, string | number | boolean>;
  /** Parent variable ← child variable; at least one. */
  outputs?: Record<string, string>;
  /** Nesting limit for this call, tighter than the engine's. */
  maxDepth?: number;
  onError?: OnErrorRoute;
  onTimeout?: OnTimeoutRoute;
  /**
   * Set when the node is a `for-each` (E21): it runs the process once per item of a list. It is drawn as a call
   * and kept verbatim; `outputs` then name the fields of each result entry.
   */
  forEach?: ForEachConfig;
}

/** The bounds and wiring of a `for-each` node. */
export interface ForEachConfig {
  /** Expression that evaluates to the list. */
  items: string;
  /** The child variable that receives each item. */
  itemInput: string;
  maxItems: number;
  maxParallel?: number;
  /** The parent variable that receives the list of results. */
  results: string;
}

export interface EngineTaskConfig {
  /** External-task topic the engine publishes for this activity. */
  service: string;
  /** Error-handling route, emitted as `on_error` and drawn as an error edge. */
  onError?: OnErrorRoute;
  /** Where the flow continues when the task is not done in time (`on_timeout`). */
  onTimeout?: OnTimeoutRoute;
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
  callProcessConfig?: CallProcessConfig;
  scriptConfig?: ScriptConfig;
  catchEventConfig?: CatchEventConfig;
  /** Bound of the loop whose back-edges return to this step (APL `loop`). */
  loop?: LoopConfig;
  /**
   * APL keys of this node that Studio does not edit, kept verbatim so saving
   * never drops them.
   */
  aplExtras?: Record<string, unknown>;
}

export interface LoopConfig {
  maxIterations: number;
  /** Where the token goes when the limit is reached; without it the engine opens an incident. */
  onExhausted?: string;
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
  /** APL `metadata` keys Studio does not edit, kept verbatim. */
  metadataExtras?: Record<string, unknown>;
  id: string;
  name: string;
  /** APL `metadata.category`: free text, authoring metadata only. Empty is left out of the YAML. */
  category: string;
  /** APL `metadata.owner`: authoring metadata only, not executed. */
  owner?: string;
  /** APL `metadata.description`; the project document keeps its own `description`. */
  processDescription?: string;
  /** APL `metadata.variables`, in declaration order; keys Studio does not edit stay on each entry. */
  variables?: VariableDeclaration[];
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
  /**
   * No node had a saved `ui` position: the canvas runs the auto-layout when it
   * opens this process. View state only — never serialized to APL.
   */
  layoutPending?: boolean;
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
