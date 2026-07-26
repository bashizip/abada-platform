# Frontend Quickstart: Keycloak Auth + Abada Engine API

This doc reflects the production-grade Keycloak integration used by this repo. The frontend authenticates with Keycloak (PKCE), then calls the Abada Engine API with a Bearer token.

## Goal
Log users in via Keycloak and authorize all API requests with `Authorization: Bearer <token>`.

## Prerequisites
- Keycloak running (dev: `http://localhost:8082`)
- Gateway reachable (dev: `https://localhost`)
- Keycloak client configured for SPA + PKCE

## Step 1: Install Keycloak SDK
```bash
npm i keycloak-js
```

## Step 2: Environment Variables (Vite)
```env
VITE_KEYCLOAK_URL=https://keycloak.localhost
VITE_KEYCLOAK_REALM=abada-dev
VITE_KEYCLOAK_CLIENT_ID=abada-frontend
VITE_API_URL=/api
```

## Step 3: Initialize Keycloak (PKCE)
```ts
// src/auth/keycloakClient.ts
import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: import.meta.env.VITE_KEYCLOAK_REALM,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
});

export async function initKeycloak() {
  return keycloak.init({
    onLoad: "check-sso",
    pkceMethod: "S256",
    silentCheckSsoRedirectUri: window.location.origin + "/silent-check-sso.html",
  });
}

export { keycloak };
```

## Step 4: Attach JWT to API Requests
All requests include a refreshed Bearer token. See `src/lib/api.ts` for the shared `ApiClient` and `refreshToken(30)` usage.

## Step 5: Task API Calls
Use the `ApiClient` in `src/lib/api.ts` to access `/v1/tasks`, `/v1/tasks/claim`, and `/v1/tasks/complete`.

## Notes
- The login screen lives at `/login` and triggers the Keycloak redirect.
- All routes are protected; unauthenticated users are redirected to `/login`.
- Tokens are kept in memory only (no `localStorage`).
- The API expects Bearer tokens only (no `X-User`/`X-Groups` headers).
