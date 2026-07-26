/* eslint-disable @typescript-eslint/no-explicit-any */
import Keycloak, {
  type KeycloakProfile,
  type KeycloakTokenParsed,
} from "keycloak-js";
import { runtimeConfig } from "@/config/runtime";

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
      // Keep init passive: avoid auto check/login iframe flow that often fails
      // on localhost with strict browser 3rd-party cookie policies.
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
      // Degrade gracefully: user can still authenticate via explicit login button.
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

export { keycloak };
