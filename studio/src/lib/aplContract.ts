/**
 * The APL contract served by the engine (GET /v1/apl/schema): the allowed
 * agent models and field bounds this deployment accepts. Studio reads them
 * here instead of hardcoding copies of engine rules. When the contract cannot
 * be loaded, Studio's guards step aside; the engine still enforces every rule
 * at validation and deployment.
 */
import { useSyncExternalStore } from 'react';
import { AplAPI, type AplServedSchema } from '@/api/apl';

export interface NumericBound {
  min?: number;
  max?: number;
}

export interface AplContract {
  allowedAgentModels: string[];
  scriptsEnabled: boolean;
  /** Bounds per agent field, e.g. `temperature`, `max_attempts`. */
  agentBounds: Record<string, NumericBound>;
  hitPolicies: string[];
}

let contract: AplContract | null = null;
let loading: Promise<AplContract | null> | null = null;
const listeners = new Set<() => void>();

export const contractFromSchema = (schema: AplServedSchema): AplContract => {
  const agentProperties = schema.$defs.agentNode?.properties ?? {};
  const agentBounds: Record<string, NumericBound> = {};
  for (const [field, definition] of Object.entries(agentProperties)) {
    if (definition.minimum !== undefined || definition.maximum !== undefined) {
      agentBounds[field] = { min: definition.minimum, max: definition.maximum };
    }
  }
  return {
    allowedAgentModels: schema['x-abada-runtime']?.allowedAgentModels ?? schema.$defs.agentModel?.enum ?? [],
    scriptsEnabled: schema['x-abada-runtime']?.scriptsEnabled ?? false,
    agentBounds,
    hitPolicies: schema.$defs.decisionTableNode?.properties?.hitPolicy?.enum ?? ['FIRST', 'UNIQUE', 'COLLECT'],
  };
};

/** Loads the contract once; resolves null when the engine is unreachable. */
export const loadAplContract = (): Promise<AplContract | null> => {
  if (contract) return Promise.resolve(contract);
  loading ??= AplAPI.schema()
    .then((schema) => setAplContract(contractFromSchema(schema)))
    .catch(() => {
      loading = null; // retry on the next call
      return null;
    });
  return loading;
};

export const setAplContract = (value: AplContract | null): AplContract | null => {
  contract = value;
  listeners.forEach((listener) => listener());
  return value;
};

export const aplContract = (): AplContract | null => contract;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** The served contract, or null until (or unless) it loads. */
export const useAplContract = (): AplContract | null => useSyncExternalStore(subscribe, aplContract, aplContract);
