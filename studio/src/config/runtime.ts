export interface AbadaStudioConfig {
  apiUrl: string;
  oidcUrl: string;
  oidcRealm: string;
  oidcClientId: string;
  starterWorkflowEnabled: boolean;
}

declare global {
  interface Window {
    __ABADA_STUDIO_CONFIG__?: Partial<AbadaStudioConfig>;
  }
}

const supplied = window.__ABADA_STUDIO_CONFIG__ ?? {};

const booleanValue = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
};

export const config: AbadaStudioConfig = {
  apiUrl: supplied.apiUrl ?? '/api',
  oidcUrl: supplied.oidcUrl ?? 'http://keycloak.localhost',
  oidcRealm: supplied.oidcRealm ?? 'abada-dev',
  oidcClientId: supplied.oidcClientId ?? 'abada-frontend',
  starterWorkflowEnabled: booleanValue(supplied.starterWorkflowEnabled, false),
};
