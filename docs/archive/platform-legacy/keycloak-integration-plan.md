# Keycloak Integration Plan

This document describes a practical implementation plan to integrate Keycloak as the authentication and identity provider for the abada-engine project.

## Goals

- Provide centralized authentication and user/group management via Keycloak
- Preserve the engine's auth-agnostic design by using a gateway (Traefik) to validate JWTs and inject `X-User` / `X-Groups` headers
- Provide a developer-friendly local setup using Docker Compose

## High-level steps

1. Add Keycloak and Keycloak PostgreSQL services to `docker-compose.dev.yml` (development override).
2. Provide a realm export (`docker/keycloak/realm-export.json`) and import script to pre-create a realm, clients, roles and groups for local development.
3. Update `env.example` with Keycloak-related environment variables and password placeholders.
4. Add a Traefik middleware example to validate JWTs issued by Keycloak and to inject the headers the engine expects (`X-User`, `X-Groups`).
5. Document how to run the stack, access Keycloak Admin UI, and test the end-to-end auth flow.

## Docker Compose changes (dev)

- Add two services:
  - `keycloak-db`: `postgres:15` to persist Keycloak data in development
  - `keycloak`: `quay.io/keycloak/keycloak:latest` (or pinned version) configured to use the DB and import the realm on startup

## Realm and clients

- Create a realm named `abada-dev` with a client for the frontend apps (Tenda/Orun) configured for OIDC Authorization Code flow.
- Configure client roles that map to BPMN `candidateGroups` used by the engine.

## Traefik configuration

- Add a JWT middleware example using Traefik ForwardAuth or `traefik-forward-auth` to validate tokens and then set headers:
  - `X-User`: `preferred_username` or `sub`
  - `X-Groups`: comma-separated group names from the token claim (e.g., `groups`)

Note: If Traefik cannot perform JWT validation directly in your deployment, an alternative is to use a small `auth-proxy` sidecar for header injection.

## Developer run steps (quick)

1. Copy `env.example` to `.env` and set Keycloak passwords.
2. Start the dev stack: `docker compose -f docker-compose.dev.yml up --build`.
3. Visit Keycloak Admin at `http://localhost:8080` (or configured port) and log in with admin credentials.
4. Confirm the realm and client were imported. Log in as a test user and request a token.
5. Send requests to the engine via Traefik or directly and verify `X-User`/`X-Groups` header presence.

## Next implementation steps (priority)

1. Add the Keycloak and DB services to the dev compose file (this repository change will implement this).
2. Add a realm export and import script under `docker/keycloak/`.
3. Update `env.example` with Keycloak variables.
4. Add a Traefik middleware sample in `docker/traefik/` and link to the main Traefik config.

## Notes

- The abada-engine is already designed to consume identity from headers (`X-User` and `X-Groups`). This makes integrating Keycloak straightforward: Keycloak issues JWTs, Traefik or a gateway validates them and injects headers.
- For production, pin Keycloak and Postgres images to specific versions and secure secrets using a vault or Kubernetes secrets.

---
Generated and added by the developer assistant as the initial integration plan.
