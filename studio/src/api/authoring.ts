import { keycloak } from '@/auth/keycloakClient';
import { config } from '@/config/runtime';

export interface AplGenerationCandidate {
  aplSource: string;
  provider: 'LLM' | 'LOCAL_FALLBACK';
  model?: string;
  attempts: number;
  warnings: string[];
}

export class AuthoringAPI {
  static async generate(projectId: string, prompt: string, mode: 'new' | 'refine',
    baseAplSource?: string): Promise<AplGenerationCandidate> {
    const response = await fetch(`${config.apiUrl}/v1/projects/${projectId}/authoring/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(keycloak.token ? { Authorization: `Bearer ${keycloak.token}` } : {}),
      },
      body: JSON.stringify({
        prompt,
        mode: mode === 'new' ? 'CREATE' : 'REFINE',
        baseAplSource: mode === 'refine' ? baseAplSource : undefined,
      }),
    });
    if (!response.ok) throw new Error(`${response.statusText} — ${await response.text()}`);
    return response.json();
  }
}
