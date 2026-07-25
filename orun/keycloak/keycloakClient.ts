/* eslint-disable @typescript-eslint/no-explicit-any */
import Keycloak, {
  type KeycloakProfile,
  type KeycloakTokenParsed,
} from "keycloak-js";
import { runtimeConfig } from "../config/runtime";

const keycloak = new Keycloak({
  url: runtimeConfig.oidcUrl,
  realm: runtimeConfig.oidcRealm,
  clientId: runtimeConfig.oidcClientId,
});
let keycloakInitPromise: Promise<boolean> | null = null;
let keycloakInitialized = false;

export type KeycloakUser = {
  id: string;
  username: string;
  email?: string;
};

export async function initKeycloak() {
  if (keycloakInitialized) {
    return Boolean(keycloak.authenticated);
  }
  if (keycloakInitPromise) {
    return keycloakInitPromise;
  }

  try {
    keycloakInitPromise = keycloak.init({
      // React StrictMode runs effects twice in dev.
      // Keep init single-shot by sharing one in-flight promise.
      onLoad: "check-sso",
      pkceMethod: "S256",
      checkLoginIframe: false,
      enableLogging: import.meta.env.DEV,
    });
    const authenticated = await keycloakInitPromise;
    keycloakInitialized = true;

    return authenticated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("3rd party check iframe")) {
      keycloakInitialized = true;
      return false;
    }
    throw error;
  } finally {
    keycloakInitPromise = null;
  }
}

export async function refreshToken(minValidity = 30) {
  try {
    await keycloak.updateToken(minValidity);
  } catch (error) {
    console.error("Failed to refresh Keycloak token", error);
    await keycloak.logout({ redirectUri: window.location.origin });
  }
}

export function getUserFromToken(
  tokenParsed?: KeycloakTokenParsed,
  profile?: KeycloakProfile | null,
): KeycloakUser | null {
  if (!tokenParsed) return null;
  const username =
    (tokenParsed as any).preferred_username ||
    tokenParsed.name ||
    tokenParsed.given_name ||
    "user";

  return {
    id: tokenParsed.sub || "",
    username,
    email: tokenParsed.email || profile?.email,
  };
}

export function hasOrunAdminRole(tokenParsed?: KeycloakTokenParsed): boolean {
  if (!tokenParsed) return false;
  const requiredRole = "orun-admin";
  const parsed = tokenParsed as any;
  const normalize = (value: string) => value.replace(/^\//, "");
  const realmRoles: string[] = (parsed?.realm_access?.roles || []).map(
    normalize,
  );
  const groups: string[] = (parsed?.groups || []).map(normalize);
  const clientId = runtimeConfig.oidcClientId;
  const directClientRoles: string[] = (
    parsed?.resource_access?.[clientId]?.roles || []
  ).map(normalize);
  const anyClientRoles: string[] = Object.values(parsed?.resource_access || {})
    .flatMap(
      (resource: Record<string, unknown>) =>
        (resource as { roles?: string[] })?.roles || [],
    )
    .map(normalize);

  if (realmRoles.includes(requiredRole) || groups.includes(requiredRole)) {
    return true;
  }

  if (
    directClientRoles.includes(requiredRole) ||
    anyClientRoles.includes(requiredRole)
  ) {
    return true;
  }

  try {
    if (keycloak.hasRealmRole(requiredRole)) return true;
    if (clientId && keycloak.hasResourceRole(requiredRole, clientId))
      return true;
  } catch (error) {
    // Ignore and fall through to false.
  }

  return false;
}

export { keycloak };
