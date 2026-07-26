export type AbadaRuntimeConfig = {
  apiUrl: string;
  oidcUrl: string;
  oidcRealm: string;
  oidcClientId: string;
};

declare global {
  interface Window {
    __ABADA_CONFIG__?: Partial<AbadaRuntimeConfig>;
  }
}

const supplied = window.__ABADA_CONFIG__ ?? {};

function required(name: string, runtimeValue?: string, buildValue?: string) {
  const value = runtimeValue || buildValue;
  if (!value?.trim()) {
    throw new Error(`Missing Abada runtime configuration: ${name}`);
  }
  return value.replace(/\/+$/, "");
}

function requiredUrl(name: string, runtimeValue?: string, buildValue?: string) {
  const value = required(name, runtimeValue, buildValue);
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`Invalid Abada runtime URL: ${name}`);
  }
  return value;
}

export const runtimeConfig: AbadaRuntimeConfig = Object.freeze({
  apiUrl: requiredUrl("apiUrl", supplied.apiUrl, import.meta.env.VITE_API_URL || "/api"),
  oidcUrl: requiredUrl("oidcUrl", supplied.oidcUrl, import.meta.env.VITE_KEYCLOAK_URL),
  oidcRealm: required("oidcRealm", supplied.oidcRealm, import.meta.env.VITE_KEYCLOAK_REALM),
  oidcClientId: required(
    "oidcClientId",
    supplied.oidcClientId,
    import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
  ),
});
