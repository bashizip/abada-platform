# Docker platform deployment

This is the authoritative operational contract for the 1.0 release-candidate
Compose distribution. The reader-oriented procedures are published in the
[Starlight user guide](../../documentation/src/content/docs/user/index.mdx).

## Supported composition

| Files | Result |
| --- | --- |
| `compose.yaml` + `compose.dev.yaml` | PostgreSQL, Engine, Studio, Docs, bundled Keycloak and local HTTP routing |
| `compose.yaml` + `compose.prod.yaml` | PostgreSQL, versioned application images, external OIDC and Traefik TLS |
| either profile + `compose.telemetry.yaml` | Optional bundled metrics, traces and logs |

The older `docker-compose*.yml` and generated release Compose files are
removed. H2 is not a certified platform deployment.

## Development

```bash
./release/abada-platform doctor dev
./release/abada-platform up dev
```

The development environment creates `.env.dev` from safe defaults, uses HTTP
on `.localhost`, and requires no `mkcert`. PostgreSQL and the Keycloak database
are available only on the internal Compose network.

## Production

```bash
cp release/.env.prod.example .env.prod
# Replace every placeholder.
./release/abada-platform doctor prod --env-file .env.prod
./release/abada-platform up prod --env-file .env.prod
```

Production Compose interpolation requires a database secret, exact image
version, API/Studio hostnames, ACME email, explicit CORS origins and OIDC
settings. Missing values fail during `docker compose config`, before a
container is created. Only Traefik publishes 80/443. Production identity is
external; bundled Keycloak is development-only.

## Release artifact

```bash
./release/build-bundle.sh 1.0.0-rc.2
```

The result under `release/dist/` contains all Compose/configuration assets,
environment templates, launchers, sample workflows and a SHA-256 file. It has
no build context or dependency on a repository clone. The Linux/macOS and
PowerShell quickstarts download both files and verify the checksum before
extracting.

## Verification

```bash
./scripts/test/validate-platform-deployment.sh
```

This validates dev and production configuration with telemetry disabled,
bundled and external, required-variable failure, frontend startup validation,
release checksums and execution of preflight from a clean temporary directory.
Live release certification additionally runs authentication, deployment, task
completion, restart recovery, collector failure and backup/restore drills.
