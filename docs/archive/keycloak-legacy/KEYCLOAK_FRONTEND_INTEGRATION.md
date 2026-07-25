# Keycloak Frontend Integration (Current Implementation)

This document describes how frontend authentication currently works in the Abada dev stack, and the deliberate tradeoffs made to keep local development stable.

## Scope

- Frontend: `tenda/` (React + Vite)
- Gateway/auth chain: Traefik + oauth2-proxy
- API: `abada-engine` behind `/api`

## Current Flow (Tenda)

1. User opens `https://tenda.localhost`.
2. App shows `/login` if not authenticated.
3. User clicks "Sign in with Keycloak".
4. Browser is redirected to Keycloak (`https://keycloak.localhost`).
5. After successful login, Tenda receives tokens and stores them in memory.
6. API calls are sent to `/api/...` with `Authorization: Bearer <token>`.
7. Traefik routes `/api` to engine router, and oauth2-proxy validates token.
8. Engine receives request plus forwarded identity headers.

## Key Implementation Choices

### 1) Same-origin API path from frontend

- `VITE_API_URL=/api` (not `http://localhost:5601/api`)
- Implemented in:
  - `tenda/src/lib/api.ts`
  - `docker-compose.dev.yml` (`abada-tenda` env)

Reason:
- Avoid browser CORS complexity and cross-origin preflight failures in dev.
- Keep frontend-to-API calls routed through gateway policy.

### 2) Traefik routing priority to avoid host/path ambiguity

- Engine router:
  - `PathPrefix(/api)`
  - `priority=100`
- Tenda router:
  - `Host(tenda.localhost)`
  - `priority=10`

Implemented in `docker-compose.dev.yml`.

Reason:
- Without explicit priority, `/api` calls from `tenda.localhost` can be captured by the wrong router and return misleading auth/CORS errors.

### 3) Auth middleware attached to engine route, not Tenda route

- `oauth2-proxy-dev@docker` is applied on engine router.
- Tenda router serves frontend app without forward-auth middleware.

Reason:
- Browser app must load before it can obtain a token.
- API remains protected while frontend shell stays reachable.

### 4) Manual login UX (no forced auto-login on app boot)

- `initKeycloak()` is passive in `tenda/src/auth/keycloakClient.ts`.
- Login is triggered explicitly from the `/login` button (`AuthProvider`/`Login`).

Reason:
- Auto login/check-sso flow caused intermittent:
  - `Timeout when waiting for 3rd party check iframe message`
- This is common with modern browser third-party cookie restrictions in local domains.

## Dev Compromises (Intentional)

### oauth2-proxy issuer verification relaxed

`docker-compose.dev.yml` includes:
- `--insecure-oidc-skip-issuer-verification=true`

Reason:
- In dev, token issuer URL observed by browser and issuer URL used by in-cluster services can differ (`https://keycloak.localhost` vs `http://keycloak:8080`), causing false `401`.

Risk:
- Reduced strictness of token issuer validation.
- Acceptable only for local/dev environments.

### SSL verification relaxed for local certs

`docker-compose.dev.yml` includes:
- `--ssl-insecure-skip-verify=true`

Reason:
- Local self-signed cert chain.

Risk:
- TLS trust is weaker in dev.

## What We Did Not Compromise

- API still requires a Bearer token.
- oauth2-proxy still validates JWT before forwarding to engine.
- Engine endpoints are not exposed directly for browser use.
- Keycloak PKCE flow remains enabled.

## Production Hardening Checklist

Before promoting this model to prod:

1. Remove `--insecure-oidc-skip-issuer-verification=true`.
2. Remove `--ssl-insecure-skip-verify=true`.
3. Use one canonical issuer URL everywhere (Keycloak, oauth2-proxy, frontend config).
4. Tighten Keycloak client `redirectUris` and `webOrigins`.
5. Keep API as same-origin path (or add strict explicit CORS policy if cross-origin is required).

## Relevant Files

- `docker-compose.dev.yml`
- `tenda/src/auth/keycloakClient.ts`
- `tenda/src/lib/api.ts`
- `tenda/src/components/AuthProvider.tsx`
- `tenda/src/pages/Login.tsx`
- `engine/src/main/java/com/abada/engine/security/IdentityContextInterceptor.java`
