/**
 * APL types. The node and document shapes are generated from the engine-owned
 * JSON Schema (see types.generated.ts and `npm run generate:apl-types`); this
 * module only adds the convenience aliases the Studio mapping code uses.
 */
import type {
  APLDecisionTableNode,
  APLEventGatewayChild,
  APLNode,
  OnError,
} from './types.generated';

export type * from './types.generated';

export type APLNodeType = APLNode['type'];

/** `on_error`: a single target node id, or rules routed by BPMN error code. */
export type APLOnError = OnError;

export type APLHitPolicy = NonNullable<APLDecisionTableNode['hitPolicy']>;

/** A decision-table output value. */
export type APLValue = string | number | boolean;

export type APLDecisionTableInput = Extract<NonNullable<APLDecisionTableNode['inputs']>, unknown[]>[number];

export type APLDecisionTableRule = NonNullable<APLDecisionTableNode['rules']>[number];

export type { APLEventGatewayChild };
