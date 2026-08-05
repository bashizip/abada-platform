export interface AbadaStudioConfig {
  apiUrl: string;
  semaflowUrl: string;
}

declare global {
  interface Window {
    __ABADA_STUDIO_CONFIG__?: Partial<AbadaStudioConfig>;
  }
}

const supplied = window.__ABADA_STUDIO_CONFIG__ ?? {};

export const config: AbadaStudioConfig = {
  apiUrl: supplied.apiUrl ?? '/api',
  semaflowUrl: supplied.semaflowUrl ?? '/semaflow/api/v1',
};
