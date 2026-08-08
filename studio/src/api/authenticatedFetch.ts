import { keycloak } from '@/auth/keycloakClient';

let tokenRefresh: Promise<boolean> | null = null;

const ensureFreshToken = async (minValidity: number): Promise<void> => {
  if (!keycloak.authenticated) return;
  if (!tokenRefresh) {
    tokenRefresh = keycloak.updateToken(minValidity).finally(() => {
      tokenRefresh = null;
    });
  }
  await tokenRefresh;
  if (!keycloak.token) throw new Error('Authentication session has no access token');
};

const requestWithCurrentToken = (input: string | URL, init: RequestInit): Promise<Response> => {
  const headers = new Headers(init.headers);
  if (keycloak.token) headers.set('Authorization', `Bearer ${keycloak.token}`);
  return fetch(input, { ...init, headers });
};

/**
 * Refreshes Keycloak before protected API calls and retries once if the Engine
 * rejects a token that became stale between the refresh check and the request.
 */
export const authenticatedFetch = async (
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> => {
  try {
    await ensureFreshToken(30);
    let response = await requestWithCurrentToken(input, init);
    if (response.status === 401 && keycloak.authenticated) {
      await ensureFreshToken(-1);
      response = await requestWithCurrentToken(input, init);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Authentication session expired. Sign in again. (${message})`);
  }
};

export const apiError = async (response: Response): Promise<Error> => {
  let message = response.statusText || `HTTP ${response.status}`;
  try {
    const payload = await response.json() as { message?: string };
    if (payload.message) message = payload.message;
  } catch {
    // Keep the status text when the endpoint did not return a typed JSON error.
  }
  return new Error(`${response.status} ${message}`);
};
