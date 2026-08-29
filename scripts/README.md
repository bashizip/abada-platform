# Repository scripts

The supported deployment entrypoint is `release/abada-platform`; the scripts
under `scripts/dev` are thin wrappers around it for the common local-development
workflows.

```bash
./release/abada-platform doctor dev
./release/abada-platform up dev
./release/abada-platform doctor prod --env-file .env.prod
./release/abada-platform up prod --env-file .env.prod
```

Add `--telemetry` for the bundled observability overlay. Build a self-contained
release archive with `./release/build-bundle.sh VERSION`. The deployment
contract check is `./scripts/test/validate-platform-deployment.sh`.
Installer distribution is checked by
`./scripts/test/verify-install-distribution.sh`; the emergency R2 upload helper
is `./scripts/release/upload-bundle-to-r2.sh VERSION`. Normal tag releases use
the automated workflow documented in [`install/README.md`](../install/README.md).

The former TLS setup and Docker Hub publishing helpers were removed. Local
development now uses HTTP and the release workflow publishes immutable GHCR
tags.

## Local development scripts

| Script | What it does |
| --- | --- |
| `scripts/dev/up.sh` | Start the full dev stack with local Engine, Studio, and agent-worker images. The agent is automatic; use `--no-agent` only for diagnostics, `--telemetry` for observability, or `--agent-image <ref>` to pin a remote worker tag. |
| `scripts/dev/rebuild.sh` | Build Engine + Studio from the working tree and restart just those two services (`--no-cache`). |
| `scripts/dev/clean.sh` | Stop everything and wipe all volumes (`-y` to skip confirmation). |
| `scripts/dev/logs.sh` | Tail logs for all services or specific ones: `./scripts/dev/logs.sh abada-engine`. |
| `scripts/dev/build-agent-worker.sh` | Stand-alone rebuild of the first-party agent worker (e.g. `--no-cache`). Not needed on the happy path — `up.sh` already builds and provisions it. |
| `scripts/dev/provision-agent-worker.sh` | Provision the Keycloak client, group membership, and global capability registration for the agent worker. |

## Agent worker provisioning

The agent-worker client is **not** part of the Keycloak realm import because it
needs a per-deployment OIDC client secret stored in `.env.dev`. After `clean.sh`
wipes the Keycloak volume, that client and its engine-side capability
registration are lost. The happy path is still one command:

```bash
./scripts/dev/up.sh
```

`up.sh` starts the base stack, generates and stores a strong OIDC client secret
when necessary, provisions the Keycloak client and engine-side worker
capabilities, removes any stale profile-gated worker container, and then starts
the worker. Run `provision-agent-worker.sh` manually only if the engine or
Keycloak were wiped while the base stack stayed running. The provisioning step
requires `curl` on the host and a healthy Keycloak + Engine; it does not require
`jq` or a manually chosen secret.

Alice's admin group membership comes directly from the bundled Keycloak realm
import (`docker/keycloak/import/realm-dev.json`); no separate provisioning
step is needed.
