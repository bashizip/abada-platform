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
