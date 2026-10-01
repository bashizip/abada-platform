import { config } from '@/config/runtime';
import { authenticatedFetch } from '@/api/authenticatedFetch';

/**
 * An AI provider as the engine reports it. The API key is write-only: only a
 * hint (`****abcd`) ever comes back. `activeSource` says which source serves
 * this provider now: a key saved in Studio wins over the environment.
 */
export interface AiProvider {
  id: string;
  displayName: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyHint: string;
  modelPatterns: string[];
  defaultModel: string | null;
  timeoutMs: number;
  enabled: boolean;
  insightDefault: boolean;
  saved: boolean;
  configured: boolean;
  activeSource: 'STUDIO' | 'ENVIRONMENT' | null;
  environmentConfigured: boolean;
  environmentKeyHint: string | null;
}

/** Create or update request; a blank `apiKey` keeps the stored key. */
export interface AiProviderRequest {
  displayName?: string;
  providerType?: string;
  baseUrl?: string;
  apiKey?: string;
  modelPatterns?: string[];
  defaultModel?: string;
  timeoutMs?: number;
  enabled?: boolean;
  insightDefault?: boolean;
}

export interface AiProvidersStatus {
  configured: boolean;
  unconfiguredModels: string[];
  insightProviderId: string | null;
  insightModel: string | null;
}

export interface AiConnectionTestResult {
  success: boolean;
  status: 'READY' | 'NOT_CONFIGURED' | 'ERROR';
  latencyMs?: number | null;
  model?: string | null;
  message: string;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.message === 'string' && body.message) return body.message;
  } catch {
    // not JSON
  }
  return `${fallback}: ${res.status} ${res.statusText}`.trim();
}

export class AiProvidersAPI {
  private static readonly BASE_URL = `${config.apiUrl}/v1/ai-providers`;
  private static readonly HEADERS: HeadersInit = { 'Content-Type': 'application/json' };

  static async list(): Promise<AiProvider[]> {
    const res = await authenticatedFetch(this.BASE_URL, { headers: this.HEADERS });
    if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load AI providers'));
    return res.json();
  }

  /** Which of `models` no configured provider serves (any signed-in user may ask). */
  static async status(models: string[] = []): Promise<AiProvidersStatus> {
    const query = new URLSearchParams();
    models.forEach((model) => query.append('model', model));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const res = await authenticatedFetch(`${this.BASE_URL}/status${suffix}`, { headers: this.HEADERS });
    if (!res.ok) throw new Error(await errorMessage(res, 'Failed to check AI providers'));
    return res.json();
  }

  static async save(id: string, request: AiProviderRequest): Promise<AiProvider> {
    const res = await authenticatedFetch(`${this.BASE_URL}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: this.HEADERS,
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(await errorMessage(res, 'Failed to save AI provider'));
    return res.json();
  }

  static async remove(id: string): Promise<void> {
    const res = await authenticatedFetch(`${this.BASE_URL}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.HEADERS,
    });
    if (!res.ok) throw new Error(await errorMessage(res, 'Failed to remove AI provider'));
  }

  /** Tests the saved provider, or unsaved overrides (for example a key typed but not saved yet). */
  static async test(id: string, overrides?: { providerType?: string; baseUrl?: string; apiKey?: string; model?: string }): Promise<AiConnectionTestResult> {
    const res = await authenticatedFetch(`${this.BASE_URL}/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      headers: this.HEADERS,
      body: JSON.stringify(overrides ?? {}),
    });
    if (!res.ok) throw new Error(await errorMessage(res, 'Connection test failed'));
    return res.json();
  }
}
