# Engine API v1 contract

Abada 0.11 freezes the public engine API under `/api/v1`. The `/api` prefix is
the servlet context; controller and OpenAPI paths therefore begin with `/v1`.
Existing `/api/v1` clients do not need a URL migration.

## Compatibility policy

- Existing paths, HTTP methods, field names, field types, status meanings and
  machine-readable error-code meanings remain compatible throughout API v1.
- Optional fields, new endpoints, new enum values and new response headers may
  be added. Clients must ignore unknown response fields.
- Removing or renaming a field, narrowing accepted input, or changing a field
  type requires a future API version.
- List bodies remain JSON arrays for compatibility. Pagination metadata is in
  `X-Page`, `X-Page-Size`, `X-Total-Count`, and `X-Total-Pages`.
- `page` is zero-based, `size` is between 1 and 100, and default size is 50.
- Mutations accept an optional `Idempotency-Key`; replaying the same request
  returns its stored result, while reusing the key for different input fails.

The executable compatibility manifest is
`engine/src/test/resources/contracts/api-v1-contract.json`.
`OpenApiContractTest` compares it to SpringDoc's generated document in CI and
also prevents persistence entities from leaking into public schemas.

## Typed errors

Every JSON API error uses this envelope:

```json
{
  "timestamp": "2026-07-19T12:00:00Z",
  "status": 403,
  "code": "ACCESS_DENIED",
  "message": "The authenticated identity does not have permission for this operation",
  "path": "/api/v1/jobs",
  "traceId": "0123456789abcdef0123456789abcdef",
  "details": {}
}
```

Codes are stable machine contracts. API v1 currently defines:
`INVALID_REQUEST`, `BPMN_VALIDATION_FAILED`, `ENGINE_COMMAND_REJECTED`,
`RESOURCE_NOT_FOUND`, `CONCURRENT_MODIFICATION`,
`AUTHENTICATION_REQUIRED`, `ACCESS_DENIED`, `IDEMPOTENCY_CONFLICT`,
`WORKER_LOCK_NOT_OWNED`, `WORKER_LOCK_EXPIRED`, and `INTERNAL_ERROR`.
Messages are for people and may become more precise without a version change.

## Bounded list filters

| Resource | Filters | Stable order |
| --- | --- | --- |
| Process definitions | `key`, `page`, `size` | key ascending, version descending |
| Process instances | `status`, `processDefinitionId`, `page`, `size` | start descending, ID ascending |
| User tasks | `status`, `page`, `size` | start ascending, ID ascending |
| Incidents/jobs | `withException`, `active`, `page`, `size` | ID ascending |
| Instance history | `page`, `size` | occurrence ascending, ID ascending |

The generated document is served at `/api/v3/api-docs`, and Swagger UI at
`/api/swagger-ui.html`.

## Project-scoped APL authoring

`POST /api/v1/projects/{projectId}/authoring/generate` accepts `prompt`, a
`CREATE` or `REFINE` mode, and `baseAplSource` for refinement. It requires an
explicit active-project `OWNER` or `MAINTAINER` membership; global platform
administration does not bypass this product-authoring boundary.

The response contains a review-only `aplSource`, `provider` (`LLM` or
`LOCAL_FALLBACK`), optional `model`, `attempts`, and non-sensitive `warnings`.
The Engine validates every result with `AplParser`, retries an invalid model
candidate at most twice, and returns a deterministic valid starter if the
OpenAI-compatible provider is absent or unavailable. This endpoint never
persists or deploys its candidate; Studio requires an explicit Apply action.

## Worker health

`GET /api/v1/projects/{projectId}/workers/health` returns the operational
liveness and incident state of every bound (or attempted) external
worker/topic in the project: principal, topic, binding status, derived
liveness (`ONLINE`, `OFFLINE`, `ERROR`), last heartbeat, last success, last
rejection message and timestamp, consecutive failures and the last reported
worker id. It is readable by `VIEWER`, `OPERATOR` and `OWNER` memberships.

The engine records a worker heartbeat on every `fetch-and-lock` poll
(debounced to at most one write per ten seconds per topic), and records any
rejected fetch — unbound worker, topic outside the binding — as a durable
error row, so a failing agent worker is visible in the operations surface
instead of only its own container logs. Rows are operational metadata, not
workflow state; writes never block or fail the fetch, and records older than
24 hours are not returned.

First-party engine workers (by default the `service-account-abada-agent-worker`
principal bound to topic `abada:agent`, overridable via `abada.workers.first-party`)
are bound to every project automatically: on project creation, and through an
idempotent startup sweep that backfills projects created before the principal
first appeared. Manual `PUT .../workers/{principalId}` bindings are still
supported for third-party workers.

## Platform administration

The Keycloak Admin API is proxied under `/api/v1/admin/**` so operators do
not need access to the IdP console. Every endpoint requires the `abada-admin`
authority (mapped from the `abada-admin` group via the JWT `groups` claim,
or directly in trusted-proxy mode). When the proxy is not configured
(`ABADA_KEYCLOAK_*` env vars missing), the endpoints return `503` with an
empty body and the `/status` endpoint reports `configured: false`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/status` | Reports whether the identity proxy is configured and which realm it targets. Safe to poll. |
| `GET` | `/api/v1/admin/users?query=<term>` | Lists Keycloak users; `query` is a substring over `username`, `email`, `firstName`, `lastName` and is forwarded as-is to Keycloak. |
| `GET` | `/api/v1/admin/users/{id}` | Returns a single user with their group memberships. |
| `POST` | `/api/v1/admin/users` | Creates a user. Body is `CreateUserRequest` (`username`, `email`, `firstName`, `lastName`, optional initial `password`, optional `enabled`, optional `groupIds`). Returns the created user with Keycloak-assigned `id`. |
| `PUT` | `/api/v1/admin/users/{id}` | Updates mutable profile fields and the `enabled` flag. Group membership is changed through the dedicated endpoints below. |
| `PUT` | `/api/v1/admin/users/{userId}/groups/{groupId}` | Adds the user to a Keycloak group. Idempotent: a duplicate call returns `204`. |
| `DELETE` | `/api/v1/admin/users/{userId}/groups/{groupId}` | Removes the user from a Keycloak group. Idempotent. |
| `GET` | `/api/v1/admin/groups` | Lists Keycloak groups with member counts. |
| `POST` | `/api/v1/admin/groups?name=<group>` | Creates a top-level Keycloak group. |

### Constraints

- These endpoints **mutate IdP state**. They are not part of the engine
  persistence model; a successful call is not transactional with the engine
  database.
- The engine never returns the service-account `clientSecret`, the user's
  `password`, or any other IdP-managed credential to the browser.
- Mutations are not idempotent at the engine layer (Keycloak does not echo an
  `Idempotency-Key` back); clients must rely on UI-level guards or knowledge
  of the realm.
- The principal cache (`PrincipalEntity`) is populated lazily on first
  authenticated request, so a freshly created user becomes project-searchable
  only after their first sign-in to the engine — see
  [`docs/operations/studio-administration.md`](../operations/studio-administration.md).
- Audit history for these mutations is logged in the engine audit trail but
  not yet exposed as a UI; see
  [`studio-app-spec.md`](../development/studio-app-spec.md) for the deferred
  audit-tab work.

### Error envelope

The proxy maps Keycloak errors into the standard v1 `ErrorResponse` envelope.
A `409` from Keycloak (for example, duplicate `username` or `email`) is
returned as-is with `code: ENGINE_COMMAND_REJECTED`. A misconfigured
`abada-admin-api` client returns `503` with an empty body and
`configured: false` from `/status`.

