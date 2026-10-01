import { config } from '@/config/runtime';
import { apiError, authenticatedFetch } from '@/api/authenticatedFetch';

/** One finding from the engine's APL validation (deploy uses the same pipeline). */
export interface AplValidationIssue {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  /** JSON Pointer into the document, e.g. `/flow/nodes/3/temperature`. */
  path?: string;
  elementId?: string;
  suggestedResolution?: string;
}

export interface AplValidationResult {
  valid: boolean;
  processKey?: string;
  issues: AplValidationIssue[];
}

/** The served APL JSON Schema; only the parts Studio reads are typed. */
export interface AplServedSchema {
  $defs: Record<string, { properties?: Record<string, { minimum?: number; maximum?: number; enum?: string[] }>;
    enum?: string[] }>;
  'x-abada-runtime'?: {
    languageVersion: string;
    scriptsEnabled: boolean;
    schemaViolations: 'WARNING' | 'ERROR';
    maxSourceBytes: number;
    allowedAgentModels: string[];
  };
}

export class AplAPI {
  static async schema(): Promise<AplServedSchema> {
    const response = await authenticatedFetch(`${config.apiUrl}/v1/apl/schema`);
    if (!response.ok) throw await apiError(response);
    return response.json();
  }

  static async validate(source: string): Promise<AplValidationResult> {
    const response = await authenticatedFetch(`${config.apiUrl}/v1/apl/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    if (!response.ok) throw await apiError(response);
    return response.json();
  }
}
