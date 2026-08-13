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
