# Deployment Support Matrix

| Profile | Identity | Telemetry mode | Distribution | 1.0-RC evidence status |
|---|---|---|---|---|
| Development | Bundled Keycloak, direct JWT validation | Disabled | Core + development Compose | Implemented; clean-volume CI smoke pending |
| Development | Bundled Keycloak, direct JWT validation | Bundled stack | Core + development + telemetry Compose | Implemented; signal/outage CI smoke pending |
| Development | Bundled Keycloak, direct JWT validation | External OTLP | Core + development Compose and explicit endpoint | Configuration contract passes; external collector smoke pending |
| Production | External OIDC, direct JWT validation and RBAC | Disabled | Core + production Compose | Configuration contract passes; reference-host smoke pending |
| Production | External OIDC, direct JWT validation and RBAC | Bundled stack | Core + production + telemetry Compose | Configuration contract passes; reference-host signal smoke pending |
| Production | External OIDC, direct JWT validation and RBAC | External OTLP | Core + production Compose and explicit endpoint | Configuration contract passes; external collector smoke pending |
| H2 convenience | Disabled or controlled local mode | Disabled | Engine process only | Not a certified platform topology |
| Trusted proxy compatibility | Authenticating proxy headers | Independently configurable | Custom controlled deployment | Not part of the certified Compose family; engine must be unreachable except through the proxy |

An entry becomes certified only when its roadmap evidence is checked. The
table distinguishes an implemented/configuration-valid profile from a
release-certified one so documentation never broadens the current guarantee.

Production uses `ABADA_SECURITY_MODE=oidc` and requires
`OIDC_ISSUER_URI` and `ABADA_ALLOWED_ORIGINS`. `proxy` mode trusts
`X-Auth-Request-*` headers and is unsafe when clients can reach the engine
directly. `disabled` is limited to focused local development and automated
tests.

`ABADA_TELEMETRY_ENABLED=false` is the platform default. Disabled mode does
not start an exporter and does not require an OpenTelemetry Collector. The
bundled telemetry overlay enables metrics, traces and trace-correlated logs;
production may instead set explicit OTLP endpoints for an external collector.
Telemetry delivery is diagnostic and cannot participate in workflow-state
transactions or engine readiness.

The authoritative deployment files are `compose.yaml`, `compose.dev.yaml`,
`compose.prod.yaml` and `compose.telemetry.yaml`. Downloadable deployments use
a versioned release bundle containing those files and every referenced
configuration asset; a standalone downloaded Compose file is not supported.

PostgreSQL is the production source of truth. Flyway owns the schema and
Hibernate validates it at startup. H2 is not used as evidence of PostgreSQL
concurrency correctness. Mutable workflow state is command-local;
multi-replica correlation, work acquisition, duplicate-request and failover
behavior is covered by PostgreSQL Testcontainers acceptance tests. See the
[runtime state architecture](../architecture/runtime-state.md) for the exact
boundary.
