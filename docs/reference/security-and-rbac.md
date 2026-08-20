# Authentication and RBAC

Production defaults to direct OIDC JWT validation. The engine verifies issuer,
signature, lifetime and the required `OIDC_AUDIENCE` through Spring Security. A
`preferred_username` claim becomes the actor, while the `groups` claim remains
the BPMN candidate-group identity.

Trusted proxy mode is explicit (`ABADA_SECURITY_MODE=proxy`) and is safe only
when the engine is unreachable except through the authenticating reverse
proxy. It accepts `X-Auth-Request-User`, `X-Auth-Request-Email`, and
`X-Auth-Request-Groups`; these headers are ignored in OIDC mode. Missing proxy
identity is rejected. Disabled mode is for local and automated tests only.

## Permission matrix

| Domain | OAuth scope | Security group/role | Access |
| --- | --- | --- | --- |
| Deployment | `process:deploy` | `abada-deployer` | BPMN deployments |
| Process control | `process:control` | `abada-process-controller` | starts, fail, message/signal correlation |
| Tasks | `task:read`, `task:write` | `abada-task-user` | visible-task reads and task actions |
| Operations read/write | `operations:read`, `operations:write` | `abada-operator` | instances, variables, history, incidents and retries |
| External workers | `worker:execute` | `abada-worker` | worker protocol v1 |
| Administration | n/a | `abada-admin` | all engine domains |

OIDC scopes become `SCOPE_*` authorities. Groups named above become
`ROLE_ABADA_*` authorities in OIDC and proxy modes. Business groups such as
`customers` or `managers` do not grant engine permissions by themselves.

Task authorization is also enforced against durable task assignment. A user
cannot inspect or fail another user's task merely because they possess general
task scope; claim, unclaim and completion retain assignee/candidate checks.

## HTTP controls

- Authentication and authorization failures use the API v1 typed error body.
- CORS accepts only configured origins and the documented API/trace headers.
- Request logging excludes headers and payloads; authorization tokens and
  sensitive variable bodies are never included.
- Activity history records actor, action, timestamp, workflow/activity IDs and
  trace ID for committed mutations.

Executable negative coverage is in `SecurityAuthorizationContractTest`,
`AudienceValidatorTest` and `ProxyHeaderAuthenticationFilterTest`.

## Platform administration client (`abada-admin-api`)

The Keycloak Admin API is **never** exposed to operators directly. The engine
proxies user and group management under `/v1/admin/**` (see
[`api-v1.md`](api-v1.md)) using a dedicated **confidential** Keycloak client:

- Client ID: `abada-admin-api`
- Flow: `service_accounts` only (no public login, no user impersonation)
- Secret: stored in the engine environment (`ABADA_KEYCLOAK_ADMIN_CLIENT_SECRET`),
  not in the realm import on shared machines
- Service-account realm roles: `manage-users`, `manage-groups`,
  `query-users`, `view-users`, `query-groups`, `view-groups`,
  `manage-realm`, `view-realm`
- Audience mapper: emits `abada-admin-api` so the engine can reject tokens
  issued for other clients

A successful service-account token is cached in-process for 30 s less than its
declared lifetime. A `401` from the cache forces a refresh on next call.
Operators do not see this client; they call `/v1/admin/**` through Studio, which
holds the user's JWT — not the service-account secret.

The Studio tab that surfaces these endpoints is gated on the **JWT `groups`
claim** containing the `abada-admin` group (mapped from the Keycloak group, not
a realm role). Membership of `abada-admin` in Keycloak is the bootstrap
mechanism for who can invite or remove other users; it is intentionally
separate from the `abada-admin-api` service-account identity.

### Failure modes

| Symptom in Studio | Root cause | Operator action |
| --- | --- | --- |
| Studio Administration tab missing | Caller JWT lacks `abada-admin` group | Add user to the `abada-admin` group in Keycloak (not as a realm role) |
| Administration tab visible but `GET /v1/admin/status` returns `configured: false` | Engine missing `ABADA_KEYCLOAK_*` env vars | Set them in `compose.yaml` / `.env.dev` and restart the engine |
| `503` on `/v1/admin/**` with `configured: false` in body | Identity proxy disabled by config | See [`studio-administration.md`](../operations/studio-administration.md) |
| `502` / `504` from `/v1/admin/**` | Keycloak Admin API unreachable | Verify the network path and that `ABADA_KEYCLOAK_URL` resolves from the engine container |
