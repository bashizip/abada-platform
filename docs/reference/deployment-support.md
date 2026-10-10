# Deployment Support Matrix

| Profile | Identity | Telemetry mode | Distribution | 1.0-RC evidence status |
|---|---|---|---|---|
| Development | Bundled Keycloak, direct JWT validation | Disabled | Core + development Compose | Implemented; clean-volume CI smoke pending |
| Development | Bundled Keycloak, direct JWT validation | Bundled stack | Core + development + telemetry Compose | Implemented; signal/outage CI smoke pending |
| Development | Bundled Keycloak, direct JWT validation | External OTLP | Core + development Compose and explicit endpoint | Configuration contract passes; external collector smoke pending |
| Production | External OIDC, direct JWT validation and RBAC | Disabled | Core + production Compose | Configuration contract passes; reference-host smoke pending |
| Production | External OIDC, direct JWT validation and RBAC | Bundled stack | Core + production + telemetry Compose | Configuration contract passes; reference-host signal smoke pending |
| Production | External OIDC, direct JWT validation and RBAC | External OTLP | Core + production Compose and explicit endpoint | Configuration contract passes; external collector smoke pending |
| Server (single VM) | Bundled Keycloak in production mode, direct JWT validation and RBAC | Disabled | Core + server Compose | Configuration contract and local end-to-end start pass; public reference host `demo.abadaplatform.com` (GCP): TLS, routing, OIDC, exposure and reboot checks pass 2026-09-28; Studio sign-in and agent run pending |
| H2 convenience | Disabled or controlled local mode | Disabled | Engine process only | Not a certified platform topology |
| Trusted proxy compatibility | Authenticating proxy headers | Independently configurable | Custom controlled deployment | Not part of the certified Compose family; engine must be unreachable except through the proxy |

An entry becomes certified only when its roadmap evidence is checked. The
table distinguishes an implemented/configuration-valid profile from a
release-certified one so documentation never broadens the current guarantee.

`1.1.0-rc.2` is prepared as an evaluation release candidate with the
executable Compose configuration, preflight, archive and
PostgreSQL/Testcontainers evidence. It does not claim a completed public-cloud
production certification. Public TLS, external-OIDC reference-host testing,
multi-host failover, rolling upgrades and supply-chain certification are not
yet scheduled on the [roadmap](../development/roadmap.md).

Abada release images must publish `linux/amd64` and `linux/arm64` manifests.
The original `1.0.0-rc.1` images are a documented exception: they contain only
`linux/amd64`. The repository launcher detects those exact images on an ARM64
Docker host and enables Docker's `amd64` compatibility mode. The tag remains
immutable; subsequent release-image publication fails unless both native
platforms are present. `1.0.0-rc.3` is the first release published under that
multi-architecture gate.

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

The server profile runs every component on one host for one public domain
(`ABADA_DOMAIN` plus its `api.`, `auth.` and `docs.` subdomains) with Let's
Encrypt certificates. It is intended for evaluations and public demos on a
single VM; it is not a multi-replica or high-availability topology. See
[single-VM server on Google Cloud](../operations/gcp-vm.md).

The authoritative deployment files are `compose.yaml`, `compose.dev.yaml`,
`compose.prod.yaml`, `compose.server.yaml` and `compose.telemetry.yaml`. Downloadable deployments use
a versioned release bundle containing those files and every referenced
configuration asset; a standalone downloaded Compose file is not supported.

PostgreSQL is the production source of truth. Flyway owns the schema and
Hibernate validates it at startup. H2 is not used as evidence of PostgreSQL
concurrency correctness. Mutable workflow state is command-local;
multi-replica correlation, work acquisition, duplicate-request and failover
behavior is covered by PostgreSQL Testcontainers acceptance tests. See the
[runtime state architecture](../architecture/runtime-state.md) for the exact
boundary.
