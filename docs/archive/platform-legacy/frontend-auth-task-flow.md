# Frontend Quickstart: Keycloak Auth + Task Advancement in Abada Engine

This quickstart shows how a frontend app authenticates a user with Keycloak, then advances a task in **abada-engine** through the gateway.

## Goal
Enable a frontend to log in a user (e.g., **lucas**) and complete a task via the Abada Engine API.

## Prerequisites
- Keycloak running (dev: `http://localhost:8082`)
- Traefik / Gateway reachable (dev: `https://localhost`)
- A Keycloak client configured for the frontend (PKCE)

## Step 1: Install Keycloak SDK
Why: the frontend needs a standards‑compliant OIDC client to handle the login flow, token storage, and refresh logic. `keycloak-js` is the official browser SDK used across the repo.

```bash
npm i keycloak-js
```

## Step 2: Environment Variables
Why: keeping endpoints and client identifiers in env variables lets you switch between dev/test/prod without code changes and avoids hard‑coding secrets or hostnames.

```env
REACT_APP_KEYCLOAK_URL=http://localhost:8082
REACT_APP_KEYCLOAK_REALM=abada-dev
REACT_APP_KEYCLOAK_CLIENT_ID=abada-frontend
REACT_APP_API_URL=https://localhost/api
```

## Step 3: Initialize Keycloak (PKCE)
Why: PKCE is the recommended OAuth2 flow for public clients (SPAs). It prevents token interception and is the default secure approach for browser apps.

```ts
// src/auth/keycloakAdapter.ts
import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: process.env.REACT_APP_KEYCLOAK_URL!,
  realm: process.env.REACT_APP_KEYCLOAK_REALM!,
  clientId: process.env.REACT_APP_KEYCLOAK_CLIENT_ID!,
});

export async function initKeycloak() {
  const authenticated = await keycloak.init({
    onLoad: "login-required",
    pkceMethod: "S256",
    silentCheckSsoRedirectUri: window.location.origin + "/silent-check-sso.html",
  });

  if (!authenticated) {
    console.warn("Not authenticated");
  }

  // Refresh token every 30s
  setInterval(() => {
    keycloak.refreshToken(30).success(() => {}).error(() => keycloak.logout());
  }, 30000);

  return keycloak;
}

export { keycloak };
```

## Step 4: Attach JWT to API Requests
Why: the gateway (Traefik + oauth2-proxy) only forwards requests when a valid JWT is present. Without the `Authorization` header, every call is rejected.

```ts
// src/api/apiClient.ts
import axios from "axios";
import { keycloak } from "../auth/keycloakAdapter";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "https://localhost/api",
});

api.interceptors.request.use((config) => {
  if (keycloak.token) {
    config.headers.Authorization = `Bearer ${keycloak.token}`;
  }
  return config;
});

export default api;
```

## Step 5: Task API Calls
Why: the engine exposes task operations via REST. The frontend must list tasks visible to the current user, optionally claim them, then complete them.

```ts
// src/api/tasks.ts
import api from "./apiClient";

export async function listTasks() {
  const res = await api.get("/v1/tasks");
  return res.data;
}

export async function claimTask(taskId: string) {
  const res = await api.post(`/v1/tasks/claim?taskId=${taskId}`);
  return res.data;
}

export async function completeTask(taskId: string, variables?: Record<string, unknown>) {
  const res = await api.post(`/v1/tasks/complete?taskId=${taskId}`, variables ?? {});
  return res.data;
}
```

## Step 6: Example — Advance a Task for “lucas”
Why: this sequence mirrors the normal user flow: fetch tasks, choose one that is available, claim it for the current user, then complete it with domain variables.

```ts
async function advanceLucasTask() {
  // 1) List tasks visible to lucas
  const tasks = await listTasks();

  // 2) Pick an AVAILABLE task
  const task = tasks.find((t: any) => t.status === "AVAILABLE");
  if (!task) return;

  // 3) Claim the task for lucas
  await claimTask(task.id);

  // 4) Complete the task with business variables
  await completeTask(task.id, { approved: true, reviewer: "lucas" });
}
```

## Notes
- Always call the API through **Traefik** (`https://localhost/api/...`).
- The engine is **auth-agnostic**: identity is injected by `oauth2-proxy` as headers.
- Task endpoints are documented in `docs/development/api.md`.
