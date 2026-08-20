# Studio administration operations

This document describes the runtime wiring behind the Studio **Administration**
and **Insight** tabs: the Keycloak `abada-admin-api` service-account client,
the engine's identity proxy package, and the failure modes operators see
when the wiring drifts.

It is the operational companion to the user-guide page
[`identity.mdx`](../../documentation/src/content/docs/user/identity.mdx) and
the developer reference
[`api-v1.md`](../reference/api-v1.md#platform-administration).

## Environment variables

The engine binds configuration under `abada.identity.admin.*`:

| Variable | Purpose | Required? | Example |
| --- | --- | --- | --- |
| `ABADA_KEYCLOAK_URL` | Base URL of the IdP, without `/realms/{realm}` | Yes (else `503`) | `http://keycloak:8080` |
| `ABADA_KEYCLOAK_REALM` | Target realm | Yes (else `503`) | `abada` |
| `ABADA_KEYCLOAK_ADMIN_CLIENT_ID` | Confidential client id used for the proxy | Yes (else `503`) | `abada-admin-api` |
| `ABADA_KEYCLOAK_ADMIN_CLIENT_SECRET` | Confidential client secret | Yes (else `503`) | (env-injected; never committed) |
| `OIDC_ISSUER_URI` | User JWT issuer; the audience validator reuses this | Yes (existing requirement) | `http://keycloak:8080/realms/abada` |
| `OIDC_AUDIENCE` | Required `aud` claim for both user JWTs and service-account JWTs | Yes (existing requirement) | `abada-api` or `abada-admin-api` |

The same variables are defined in `compose.yaml`, `env.example` and
`env.prod.example`. The bundled dev realm imports a stub
`abada-admin-api` client whose secret is the value baked into
`docker/keycloak/import/realm-dev.json`. Production deployments must rotate
that secret per environment and inject the value into the engine via the
secret manager rather than the realm import.

## Token caching

`KeycloakAdminTokenSupplier` holds a single in-memory service-account token
per engine instance. The supplier:

- Acquires a token via the OAuth2 client-credentials grant on first call.
- Caches it until 30 s before its declared `expires_in`.
- Treats a `401` from the Admin API as a forced refresh on the next call.
- Treats a `5xx` or a connection failure as a transient error — the caller
  (`IdentityAdminService`) propagates the failure to the controller, which
  returns `503` and an empty body for collection endpoints or the typed
  error envelope for single-resource endpoints.

Engine replicas each own their own cache. There is no cluster-wide lock: a
few extra tokens per minute is acceptable, and using `JdbcTokenStore` would
add write amplification for no operational benefit.

## Failure modes and operator response

| Symptom | Likely cause | Operator action |
| --- | --- | --- |
| Studio Administration tab missing | Caller JWT lacks `abada-admin` group | Add user to the `abada-admin` group in Keycloak (group, not role) |
| `GET /v1/admin/status` → `{"configured":false}` | `ABADA_KEYCLOAK_*` missing | Set the four env vars above and restart the engine |
| `/v1/admin/**` returns `503` with empty body | Proxy not configured, or Keycloak unreachable | Check `/v1/admin/status`, then the engine logs for `KeycloakAdminTokenSupplier` errors |
| `/v1/admin/users` returns an empty array when users exist | `query` parameter is set and excludes the user | Retry without `query`, or widen the substring |
| Newly created user cannot be added as a project member | `PrincipalEntity` not yet populated | Have the user sign in to Studio at least once, then retry the project member search |
| `401` from Keycloak on a previously working deployment | `abada-admin-api` client rotated / secret expired | Update `ABADA_KEYCLOAK_ADMIN_CLIENT_SECRET` and restart the engine; the cache forces a refresh on next call |
| `409` on `POST /v1/admin/users` | Duplicate `username` or `email` in Keycloak | Update the conflicting record first, or use a different `username` / `email` |
| `400` on `PUT /v1/admin/users/{userId}/groups/{groupId}` | Group does not exist | Use the IdP-managed group id from `GET /v1/admin/groups` |

## Production seeding checklist

When deploying against an external IdP (the supported production topology),
seed the following resources **before** the engine starts:

1. Create the `abada-admin-api` confidential client in the realm.
   - Standard flow: **off**
   - Direct access grants: **off**
   - Service accounts: **on**
   - Valid redirect URIs: empty
   - Web origins: empty
2. Assign these realm roles to the service-account user
   `service-account-abada-admin-api`:
   `manage-users`, `manage-groups`, `query-users`, `view-users`,
   `query-groups`, `view-groups`, `manage-realm`, `view-realm`.
3. Add an audience mapper on the `abada-admin-api` client that emits the
   configured `OIDC_AUDIENCE` (or a dedicated audience such as
   `abada-admin-api` if `OIDC_AUDIENCE` is reserved for user JWTs).
4. Create at least the following top-level groups: `abada-worker`,
   `abada-admin`, `abada-deployer`, `abada-task-user`, `abada-operator`,
   `abada-process-controller`, `abada-insight-reviewer`. Map each into the
   `groups` claim on the `abada-studio` public client.
5. Set the four `ABADA_KEYCLOAK_*` env vars in the engine container. Do
   **not** bake the secret into the image; source it from the runtime
   secret manager.

## Audit trail

Every successful `/v1/admin/**` mutation writes an audit row carrying the
caller's JWT subject, action, target resource, timestamp and trace ID. The
table is shared with BPMN audit history and is queryable by the operations
team, but a dedicated audit UI is **not** part of the 1.0 pitch release —
see [`studio-app-spec.md`](../development/studio-app-spec.md) for the
deferred UI work.

## Logs

Engine logs follow the existing structured format. The relevant loggers
are:

- `com.abada.engine.identity.IdentityAdminService` — per-call success and
  failure. Includes Keycloak request URI, status and elapsed milliseconds.
  Never logs the user JWT or the service-account secret.
- `com.abada.engine.identity.KeycloakAdminTokenSupplier` — token refresh
  events and explicit `401` triggers.
- `com.abada.engine.api.AdminController` — controller-level outcome
  (already covered by the access log).

Set `logging.level.com.abada.engine.identity=DEBUG` only for incident
response; the default `INFO` is sufficient for capacity review.
