import { describe, expect, it } from 'vitest';
import type { AplServedSchema } from '@/api/apl';
import { contractFromSchema } from './aplContract';
import schemaSource from '../../../engine/src/main/resources/apl/apl-v1.schema.json?raw';

const schema = JSON.parse(schemaSource) as AplServedSchema;

describe('contractFromSchema', () => {
  it('reads agent bounds and hit policies from the engine schema', () => {
    const contract = contractFromSchema(schema);
    expect(contract.agentBounds.temperature).toEqual({ min: 0, max: 2 });
    expect(contract.agentBounds.confidence_threshold).toEqual({ min: 0, max: 100 });
    expect(contract.agentBounds.max_attempts).toEqual({ min: 1, max: 20 });
    expect(contract.hitPolicies).toEqual(['FIRST', 'UNIQUE', 'COLLECT']);
  });

  it('takes the allowed models from the runtime block the engine injects', () => {
    const served: AplServedSchema = {
      ...schema,
      'x-abada-runtime': {
        languageVersion: 'abada.io/v1', scriptsEnabled: false, schemaViolations: 'WARNING',
        maxSourceBytes: 10485760, allowedAgentModels: ['house-model'],
      },
    };
    expect(contractFromSchema(served).allowedAgentModels).toEqual(['house-model']);
    expect(contractFromSchema(schema).allowedAgentModels).toEqual([]);
  });
});
