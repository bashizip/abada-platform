/* eslint-disable */
/**
 * GENERATED from engine/src/main/resources/apl/apl-v1.schema.json — do not edit.
 * Regenerate with `npm run generate:apl-types`.
 */

/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "variableName".
 */
export type VariableName = string;
/**
 * Id of a node declared in flow.nodes.
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "nodeRef".
 */
export type NodeRef = string;
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "node".
 */
export type APLNode =
  | APLWebhookNode
  | APLEndNode
  | APLAgentNode
  | APLEngineTaskNode
  | APLDecisionTableNode
  | APLScriptNode
  | APLApprovalGateNode
  | APLHumanInputNode
  | APLConditionNode
  | APLInclusiveNode
  | APLParallelNode
  | APLEventGatewayNode
  | APLMessageCatchNode
  | APLTimerNode
  | APLSignalNode;
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "nodeId".
 */
export type NodeId = string;
/**
 * Model id; the served schema lists this engine's allowed models as an enum.
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "agentModel".
 */
export type AgentModel = string;
/**
 * Error route: a node id, or a list of {code?, then}; at most one entry may omit code.
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "onError".
 */
export type OnError =
  | NodeRef
  | {
      code?: string;
      then: NodeRef;
    }[];
/**
 * ISO-8601 duration accepted by java.time.Duration (PT1H, P2D).
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "isoDuration".
 */
export type IsoDuration = string;
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "nodeType".
 */
export type NodeType =
  | 'webhook'
  | 'end'
  | 'agent'
  | 'engine-task'
  | 'decision-table'
  | 'script'
  | 'approval-gate'
  | 'human-input'
  | 'condition'
  | 'inclusive'
  | 'parallel'
  | 'event-gateway'
  | 'message-catch'
  | 'timer'
  | 'signal';

/**
 * Abada Process Language (APL) abada.io/v1. Owned by the engine; Studio types are generated from it.
 */
export interface APLDocument {
  version: 'abada.io/v1';
  metadata: APLMetadata;
  flow: APLFlow;
}
export interface APLMetadata {
  /**
   * Stable process key; derived from name when omitted.
   */
  key?: string;
  name: string;
  description?: string;
  owner?: string;
  category?: string;
  /**
   * Declared instance variables (start payload and variables written by engine-task, script or human-input nodes). Enables unknown-identifier warnings.
   */
  variables?: VariableDeclaration[];
}
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "variableDeclaration".
 */
export interface VariableDeclaration {
  name: VariableName;
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'list' | 'any';
  required?: boolean;
  description?: string;
}
export interface APLFlow {
  entry: NodeRef;
  /**
   * @minItems 1
   */
  nodes: APLNode[];
}
/**
 * Start event; flow.entry must reference the single webhook.
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "webhookNode".
 */
export interface APLWebhookNode {
  id: NodeId;
  type: 'webhook';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  ui?: UiPosition;
}
/**
 * Studio canvas position; ignored by the engine.
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "uiPosition".
 */
export interface UiPosition {
  x?: number;
  y?: number;
}
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "endNode".
 */
export interface APLEndNode {
  id: NodeId;
  type: 'end';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: never;
  ui?: UiPosition;
}
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "agentNode".
 */
export interface APLAgentNode {
  id: NodeId;
  type: 'agent';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  profile?: 'abada.agent/v1';
  model?: AgentModel;
  /**
   * Placeholders ${path} must be variable paths.
   */
  prompt?: string;
  /**
   * Input name -> CEL expression. Omit to derive inputs from prompt placeholders.
   */
  inputs?: {
    [k: string]: string;
  };
  result_variable?: VariableName;
  /**
   * JSON Schema 2020-12 the agent output must satisfy.
   */
  output_schema?: {};
  tools?: string[];
  confidence_threshold?: number;
  temperature?: number;
  /**
   * Maximum completion tokens.
   */
  max_tokens?: number;
  /**
   * Model call timeout.
   */
  timeout_ms?: number;
  /**
   * Worker attempts before the task fails.
   */
  max_attempts?: number;
  /**
   * Delay between attempts.
   */
  retry_backoff_ms?: number;
  on_low_confidence?: NodeRef;
  on_invalid_output?: NodeRef;
  on_error?: OnError;
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * Bound of the loop whose back-edges return to this node. Every cycle must return to a node that declares one.
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "loop".
 */
export interface Loop {
  /**
   * Times this node may be entered per pass of the loop; the engine exposes the current count as <id>_iteration.
   */
  max_iterations: number;
  /**
   * Id of a node declared in flow.nodes.
   */
  on_exhausted?: string;
}
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "engineTaskNode".
 */
export interface APLEngineTaskNode {
  id: NodeId;
  type: 'engine-task';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  /**
   * External-task topic.
   */
  service: string;
  on_error?: OnError;
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "decisionTableNode".
 */
export interface APLDecisionTableNode {
  id: NodeId;
  type: 'decision-table';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  decisionKey?: string;
  hitPolicy?: 'FIRST' | 'UNIQUE' | 'COLLECT';
  inputs?:
    | {
        name: string;
        expr?: string;
      }[]
    | {
        [k: string]: string;
      };
  rules?: {
    /**
     * CEL over the table inputs.
     */
    when?: string;
    otherwise?:
      | boolean
      | {
          then?: {
            [k: string]: string | number | boolean | null;
          };
        };
    /**
     * Output variables written to the instance.
     */
    then?: {
      [k: string]: string | number | boolean | null;
    };
  }[];
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * In-transaction script; deployable only when the operator enables scripts.
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "scriptNode".
 */
export interface APLScriptNode {
  id: NodeId;
  type: 'script';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  script: string;
  format?: string;
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * @deprecated
 * Deprecated alias of human-input.
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "approvalGateNode".
 */
export interface APLApprovalGateNode {
  id: NodeId;
  type: 'approval-gate';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  /**
   * Candidate groups allowed to claim the task.
   *
   * @minItems 1
   */
  assignees: string[];
  /**
   * Authoring hint only; the engine does not enforce serial or parallel sign-off.
   */
  mode?: 'serial' | 'parallel';
  /**
   * Service-level target for monitoring; not enforced by the engine yet.
   */
  sla_hours?: number;
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "humanInputNode".
 */
export interface APLHumanInputNode {
  id: NodeId;
  type: 'human-input';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  /**
   * Candidate groups allowed to claim the task.
   *
   * @minItems 1
   */
  assignees: string[];
  formKey?: string;
  /**
   * @deprecated
   * Deprecated alias of formKey.
   */
  formId?: string;
  /**
   * Authoring hint only; the engine does not enforce serial or parallel sign-off.
   */
  mode?: 'serial' | 'parallel';
  /**
   * Service-level target for monitoring; not enforced by the engine yet.
   */
  sla_hours?: number;
  /**
   * @deprecated
   * Deprecated alias of sla_hours.
   */
  slaHours?: number;
  /**
   * Reserved; currently has no runtime effect.
   */
  requireDoubleSignOff?: boolean;
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * Exclusive gateway; the else rule (or the last rule) is the default route.
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "conditionNode".
 */
export interface APLConditionNode {
  id: NodeId;
  type: 'condition';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: never;
  /**
   * @minItems 1
   */
  rules: {
    /**
     * CEL condition, usually written ${...}.
     */
    if?: string;
    /**
     * true (with then) or the target node id; marks the default route.
     */
    else?: boolean | string;
    then?: NodeRef;
  }[];
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * Fork when it declares rules, join when it declares next.
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "inclusiveNode".
 */
export interface APLInclusiveNode {
  id: NodeId;
  type: 'inclusive';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  /**
   * @minItems 1
   */
  rules?: {
    /**
     * CEL condition, usually written ${...}.
     */
    if?: string;
    /**
     * true (with then) or the target node id; marks the default route.
     */
    else?: boolean | string;
    then?: NodeRef;
  }[];
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * Fork when it declares branches, join when it declares next.
 *
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "parallelNode".
 */
export interface APLParallelNode {
  id: NodeId;
  type: 'parallel';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  /**
   * @minItems 2
   */
  branches?: NodeRef[];
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "eventGatewayNode".
 */
export interface APLEventGatewayNode {
  id: NodeId;
  type: 'event-gateway';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: never;
  /**
   * @minItems 2
   */
  events: APLEventGatewayChild[];
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "eventGatewayChild".
 */
export interface APLEventGatewayChild {
  type: 'message-catch' | 'timer' | 'signal';
  description?: string;
  message?: string;
  duration?: IsoDuration;
  signal?: string;
  next: NodeRef;
}
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "messageCatchNode".
 */
export interface APLMessageCatchNode {
  id: NodeId;
  type: 'message-catch';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  message: string;
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "timerNode".
 */
export interface APLTimerNode {
  id: NodeId;
  type: 'timer';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  duration: IsoDuration;
  loop?: Loop;
  ui?: UiPosition;
}
/**
 * This interface was referenced by `APLDocument`'s JSON-Schema
 * via the `definition` "signalNode".
 */
export interface APLSignalNode {
  id: NodeId;
  type: 'signal';
  /**
   * Human-readable node label.
   */
  description?: string;
  next?: NodeRef;
  signal: string;
  loop?: Loop;
  ui?: UiPosition;
}
