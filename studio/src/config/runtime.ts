export interface AbadaStudioConfig {
  apiUrl: string;
  oidcUrl: string;
  oidcRealm: string;
  oidcClientId: string;
}

declare global {
  interface Window {
    __ABADA_STUDIO_CONFIG__?: Partial<AbadaStudioConfig>;
  }
}

const supplied = window.__ABADA_STUDIO_CONFIG__ ?? {};

export const config: AbadaStudioConfig = {
  apiUrl: supplied.apiUrl ?? '/api',
  oidcUrl: supplied.oidcUrl ?? 'http://keycloak.localhost',
  oidcRealm: supplied.oidcRealm ?? 'abada-dev',
  oidcClientId: supplied.oidcClientId ?? 'abada-frontend',
};
