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

export class AuthoringAPI {
  /**
   * One model call in the authoring service. The answer comes whole (no streaming); aborting the
   * signal only stops waiting for it, the engine still finishes the call it started.
   */
  static async generate(projectId: string, prompt: string, mode: 'new' | 'refine',
    baseAplSource?: string, signal?: AbortSignal): Promise<AplGenerationCandidate> {
    const response = await authenticatedFetch(`${config.apiUrl}/v1/projects/${projectId}/authoring/generate`, {
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
    if (!response.ok) throw await apiError(response);
    return response.json();
  }
}
