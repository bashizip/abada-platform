# Abada platform release bundle

The release archive is self-contained: it has no build contexts and does not
require a repository clone. Extract it, copy the environment template for the
profile you need, then run the preflight before starting containers.

Release images support `linux/amd64` and `linux/arm64`. The original immutable
`1.0.0-rc.1` images contain only `linux/amd64`; the current launcher detects
that exact release on an ARM64 Docker host, prints a notice, and enables
Docker's compatibility mode. `1.0.0-rc.6` is the prepared release; RC.3 was the first
whose manifests are required to contain both native platforms.

Development:

```bash
./release/abada-platform doctor dev
./release/abada-platform up dev
```

The Bash development launcher starts the first-party agent worker by default.
On a new installation it generates an OIDC client secret in the local
`.env.dev`, provisions the bundled Keycloak realm and Engine capability, and
starts the pinned `ABADA_AGENT_WORKER_IMAGE` without an activation flag. Set
the LLM API key in `.env.dev` before running agent tasks. Use `--no-agent` only
when a core-only stack is needed for diagnostics.

The public installer securely requests and validates a Gemini key before
startup. The success screen prints every local URL and the development-only
starter account. Sign in to Studio with `alice` / `alice`; Studio creates and
deploys the AI Lead Triage starter, including its human form and local demo
adapters, without overwriting existing projects.
The bootstrap adds `bob` / `bob` as a Viewer and the exclusive member of the
Lead Triage HIGH-review task group; Alice remains the project operator.

Production:

```bash
cp release/.env.prod.example .env.prod
# Replace every placeholder and configure your external identity provider.
./release/abada-platform doctor prod
./release/abada-platform up prod
```

Add `--telemetry` to either command to run the bundled Grafana, Prometheus,
Jaeger, Loki, Grafana Alloy, and OpenTelemetry Collector stack. To export to an
external collector, omit the overlay and set `ABADA_TELEMETRY_ENABLED=true`,
`ABADA_TELEMETRY_OTLP_ENDPOINT`, and `OTEL_SDK_DISABLED=false` in the profile
environment file.

Useful commands:

```bash
./release/abada-platform status dev
./release/abada-platform logs dev
./release/abada-platform down dev
```

The development deployment uses local HTTP and creates `.env.dev` from safe
defaults. It does not require `mkcert`. Production requires PostgreSQL secrets,
public hostnames, explicit CORS origins, ACME email, and an externally managed
OIDC/Keycloak-compatible provider.

The downloadable `quickstart.sh` and `quickstart.ps1` verify the archive and
start development automatically. They resolve the default version from the
public `https://install.abadaplatform.com/latest` pointer; set
`ABADA_VERSION` for an exact immutable release and
`ABADA_RELEASE_BASE_URL` for a mirror. When invoked with the production
profile, they only install the bundle and create `.env.prod`; operators must
edit it, run `doctor prod`, and issue the explicit `up prod` command printed
by the script.
