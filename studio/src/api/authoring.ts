import { config } from '@/config/runtime';
import { apiError, authenticatedFetch } from '@/api/authenticatedFetch';

export interface AplGenerationCandidate {
  aplSource: string;
  provider: 'LLM';
  model?: string;
  attempts: number;
  /** Non-sensitive notes, including any step of the request the model left out of the process. */
  warnings: string[];
  /** For a refinement: the model's one-sentence account of the change, and the operations the engine applied. */
  summary?: string;
  patch?: Array<Record<string, unknown>>;
}

/**
 * The engine did not answer: the gateway had no engine to route to (a 502 or 503, or a
 * plain-text 404 from the proxy while the engine starts), or the network failed. Nothing was
 * generated, so asking again is safe.
 */
export class EngineUnreachableError extends Error {
  constructor(readonly status?: number) {
    super('The engine could not be reached. It may be starting or restarting.');
    this.name = 'EngineUnreachableError';
  }
}

const isGatewayFailure = (response: Response) =>
  // Not 504: a gateway timeout can hide a model call that did start.
  [502, 503].includes(response.status)
  || (response.status === 404 && !(response.headers.get('content-type') ?? '').includes('json'));

export class AuthoringAPI {
  /**
   * One model call in the authoring service. The answer comes whole (no streaming); aborting the
   * signal only stops waiting for it, the engine still finishes the call it started.
   */
  static async generate(projectId: string, prompt: string, mode: 'new' | 'refine',
    baseAplSource?: string, signal?: AbortSignal): Promise<AplGenerationCandidate> {
    let response: Response;
    try {
      response = await authenticatedFetch(`${config.apiUrl}/v1/projects/${projectId}/authoring/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        mode: mode === 'new' ? 'CREATE' : 'REFINE',
        baseAplSource: mode === 'refine' ? baseAplSource : undefined,
      }),
      signal,
      });
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      if (error instanceof TypeError) throw new EngineUnreachableError();
      throw error;
    }
    if (!response.ok) throw isGatewayFailure(response) ? new EngineUnreachableError(response.status) : await apiError(response);
    return response.json();
  }
}
