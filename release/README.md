# Abada platform release bundle

The release archive is self-contained: it has no build contexts and does not
require a repository clone. Extract it, copy the environment template for the
profile you need, then run the preflight before starting containers.

Development:

```bash
./release/abada-platform doctor dev
./release/abada-platform up dev
```

Production:

```bash
cp release/.env.prod.example .env.prod
# Replace every placeholder and configure your external identity provider.
./release/abada-platform doctor prod
./release/abada-platform up prod
```

Add `--telemetry` to either command to run the bundled Grafana, Prometheus,
Jaeger, Loki, Promtail, and OpenTelemetry Collector stack. To export to an
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
start development automatically. When invoked with the production profile,
they only install the bundle and create `.env.prod`; operators must edit it,
run `doctor prod`, and issue the explicit `up prod` command printed by the
script.
