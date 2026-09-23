# Abada installer distribution

The public Linux/macOS installer is:

```bash
curl -fsSL https://install.abadaplatform.com/install.sh | bash
```

The interactive installer reads a Gemini API key with hidden input from
`/dev/tty`, validates `gemini-3.6-flash`, and stores it only in the untracked
mode-`0600` `.env.dev`. Non-interactive automation must provide
`ABADA_AGENT_LLM_API_KEY` to the `bash` process.

Alice (`alice` / `alice`) performs the one-time Starter initialization. Bob
(`bob` / `bob`) is then the exclusive candidate for the HIGH human-review
task. Insight proposal generation uses a bounded 90-second Gemini timeout.

With no override, the script reads the version from the public `/latest`
pointer. To install an older or newly published exact version, pass the
variable to `bash` (the right-hand side of the pipeline):

```bash
curl -fsSL https://install.abadaplatform.com/install.sh | \
  ABADA_VERSION=1.0.0-rc.6 bash

curl -fsSL https://install.abadaplatform.com/install.sh | \
  ABADA_INSTALL_DIR=/opt/abada bash
```

`ABADA_RELEASE_BASE_URL` remains available for mirrors and local testing. The
installer downloads both `abada-platform-<VERSION>.tar.gz` and its `.sha256`,
verifies the SHA-256 checksum in a temporary directory, and only then extracts
and runs `./release/abada-platform up dev`.

## Distribution architecture

`install.abadaplatform.com` is the custom domain of the `abada-install`
Cloudflare Worker:

| Public path | Source | Cache policy |
| --- | --- | --- |
| `/install.sh` | `install/public/install.sh` static asset | 300 seconds |
| `/` | `install/public/index.html` static asset | normal static policy |
| `/latest` | `latest` object in R2 | `no-store` |
| `/abada-platform-<VERSION>.tar.gz` | dedicated `abada-releases` R2 bucket | one year, immutable |
| matching `.sha256` | dedicated `abada-releases` R2 bucket | one year, immutable |

The R2 bucket itself stays private. `install/worker/worker.js` exposes only the
strict versioned bundle/checksum pattern and `/latest`; all other R2 keys are
unreachable. Repository visibility therefore has no effect on installer
downloads, and no GitHub token is present in the Worker or client.

`install/install.sh` is the source copy. Keep
`install/public/install.sh` byte-identical; the distribution contract test
enforces this. A release version is never hard-coded in either copy, so normal
releases require no installer edit.

## One-time Cloudflare and GitHub setup

1. Create a dedicated bucket:

   ```bash
   npx wrangler r2 bucket create abada-releases
   ```

2. Add repository Actions secrets `CF_ACCOUNT_ID` and `CF_API_TOKEN`. Scope the
   token to this Cloudflare account/zone with only the permissions needed to
   deploy the `abada-install` Worker and write objects in R2. Do not commit the
   token.
3. Before the first Worker deployment, backfill the currently published
   bundle into R2. This avoids an availability gap while the hostname moves
   from the rc.3 static-file stopgap to the Worker:

   ```bash
   ./scripts/release/upload-bundle-to-r2.sh 1.0.0-rc.3
   ```

   The helper uses the already-built files in `release/dist/`. If they are not
   present, retrieve the original bundle and checksum from the existing public
   endpoint or the authenticated GitHub release; do not rebuild an old version
   from newer source.
4. Deploy from `install/worker/`:

   ```bash
   cd install/worker
   npx wrangler deploy
   ```

5. After the public rc.3 bundle and all four anonymous image checks pass,
   create a one-line `latest` file and upload it to R2 with Wrangler 4's
   required remote mode:

   ```bash
   printf '%s\n' 1.0.0-rc.3 >/tmp/abada-latest
   npx wrangler r2 object put abada-releases/latest --remote \
     --file /tmp/abada-latest --content-type 'text/plain; charset=utf-8' \
     --cache-control no-store
   ```

This is a one-time migration of the legacy rc.3 release, not a per-release
step. `wrangler.toml` is thereafter the source of truth for the private R2
binding, static asset directory, and `install.abadaplatform.com` custom domain.

## Publishing a release

A `v*` tag starts `.github/workflows/docker-publish-ghcr.yml`. Its image matrix
publishes Engine, Studio, Docs, and agent-worker first. Only after every image
job succeeds does it call `publish-release-bundle.yml`, which:

1. checks installer/Worker contracts;
2. builds the bundle twice and proves the checksum is reproducible;
3. attaches the bundle and checksum to the authenticated GitHub release mirror;
4. uploads both immutable objects to R2 with Wrangler's explicit `--remote`
   mode, then deploys the Worker;
5. downloads the public objects and verifies their checksum;
6. inspects all four GHCR tags without a registry login;
7. runs the public installer and stack startup on a clean runner; and
8. updates `/latest` last.

This ordering means a missing/private image or a failed clean-machine startup
cannot become the default release. A new version needs only the normal tag
release workflow—never a copy into `install/public/`.

For a retry of an existing tag that contains this release automation, run
**Publish release bundle** manually and provide the exact `v...` tag. The
workflow checks out that tag and performs the same verification. Manual runs
do not change `/latest` unless **Promote** is explicitly selected. Promotions
are serialized so concurrent tags cannot race to write `/latest`.

## Manual artifact upload

The emergency helper validates the local checksum and refuses to overwrite a
version whose R2 checksum differs:

```bash
./release/build-bundle.sh 1.0.0-rc.6
./scripts/release/upload-bundle-to-r2.sh 1.0.0-rc.6
```

It intentionally does not update `/latest`. Prefer the manual workflow retry,
which also verifies anonymous image pulls and an end-to-end install before
promotion.

## GHCR visibility prerequisite

The one-time package setting remains external to this repository: the
`abada-engine`, `abada-studio`, `abada-docs`, and `abada-agent-worker` GHCR
packages must allow anonymous pulls. The release workflow verifies this
without logging in and stops before `/latest` promotion if any package is
private or missing.

## Local verification

```bash
./scripts/test/verify-install-distribution.sh
npm test --prefix install/worker
./scripts/test/validate-platform-deployment.sh
```

The first test covers automatic `/latest` resolution, the exact-version
override, checksum-before-extraction behavior, stack-launch invocation,
installer-copy synchronization, and the five-minute installer cache header.
