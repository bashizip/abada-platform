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

The former TLS setup and Docker Hub publishing helpers were removed. Local
development now uses HTTP and the release workflow publishes immutable GHCR
tags.

## Local development scripts

| Script | What it does |
| --- | --- |
| `scripts/dev/up.sh` | Start the full dev stack with local Engine + Studio images (`--agent`, `--telemetry` flags). |
| `scripts/dev/rebuild.sh` | Build Engine + Studio from the working tree and restart just those two services (`--no-cache`). |
| `scripts/dev/clean.sh` | Stop everything and wipe all volumes (`-y` to skip confirmation). |
| `scripts/dev/logs.sh` | Tail logs for all services or specific ones: `./scripts/dev/logs.sh abada-engine`. |
| `scripts/dev/build-agent-worker.sh` | Build the first-party agent worker and restart only that service. |
| `scripts/dev/provision-agent-worker.sh` | Provision the Keycloak client, group membership, and global capability registration for the agent worker. |

## Agent worker provisioning

The agent-worker client is **not** part of the Keycloak realm import because it
needs a per-deployment OIDC client secret stored in `.env.dev`. After `clean.sh`
wipes the Keycloak volume, that client and its engine-side capability
registration are
lost. Re-provision after a full clean:

```bash
./scripts/dev/up.sh --agent
./scripts/dev/provision-agent-worker.sh   # recreates the client + capabilities
```

`up.sh --agent` already runs this step once the stack is healthy; run it again
manually if the engine or Keycloak were wiped afterwards. The step is separate
because it requires `jq`/`curl` on the
host, a non-empty `ABADA_AGENT_OIDC_CLIENT_SECRET` in `.env.dev`, and a healthy
Keycloak + Engine.

Alice's admin group membership comes directly from the bundled Keycloak realm
import (`docker/keycloak/import/realm-dev.json`); no separate provisioning
step is needed.
