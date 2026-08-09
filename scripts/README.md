# Repository scripts

The supported deployment entrypoint is `release/abada-platform`; the scripts
under `scripts/dev` and `scripts/prod` are thin compatibility wrappers.

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

To rebuild and redeploy only the local Engine and Studio services in an
already-running development stack:

```bash
./scripts/dev/rebuild-engine-studio.sh
# Force clean Docker build layers when needed:
./scripts/dev/rebuild-engine-studio.sh --no-cache
```
