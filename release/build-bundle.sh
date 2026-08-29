#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:?Usage: ./release/build-bundle.sh VERSION}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || {
  echo "Error: VERSION must be an immutable semantic version, for example 1.0.0-rc.3" >&2
  exit 64
}
OUTPUT_DIR="$ROOT_DIR/release/dist"
BUNDLE_NAME="abada-platform-$VERSION"
STAGING="$OUTPUT_DIR/$BUNDLE_NAME"
ARCHIVE="$OUTPUT_DIR/$BUNDLE_NAME.tar.gz"

rm -rf "$STAGING" "$ARCHIVE" "$ARCHIVE.sha256"
mkdir -p "$STAGING/release" "$STAGING/deployment" "$STAGING/docker/keycloak/import" "$STAGING/docker/grafana"

cp "$ROOT_DIR/compose.yaml" "$ROOT_DIR/compose.dev.yaml" "$ROOT_DIR/compose.prod.yaml" "$ROOT_DIR/compose.telemetry.yaml" "$STAGING/"
cp -R "$ROOT_DIR/deployment/telemetry" "$STAGING/deployment/"
cp -R "$ROOT_DIR/docker/grafana/provisioning" "$ROOT_DIR/docker/grafana/dashboards" "$STAGING/docker/grafana/"
cp "$ROOT_DIR/docker/keycloak/import/realm-dev.json" "$STAGING/docker/keycloak/import/"
sed \
  -e "s|^ABADA_ENGINE_IMAGE=.*|ABADA_ENGINE_IMAGE=ghcr.io/bashizip/abada-engine:$VERSION|" \
  -e "s|^ABADA_STUDIO_IMAGE=.*|ABADA_STUDIO_IMAGE=ghcr.io/bashizip/abada-studio:$VERSION|" \
  -e "s|^ABADA_DOCS_IMAGE=.*|ABADA_DOCS_IMAGE=ghcr.io/bashizip/abada-docs:$VERSION|" \
  -e "s|^ABADA_AGENT_WORKER_IMAGE=.*|ABADA_AGENT_WORKER_IMAGE=ghcr.io/bashizip/abada-agent-worker:$VERSION|" \
  "$ROOT_DIR/release/.env.dev.example" >"$STAGING/release/.env.dev.example"
sed "s|^ABADA_VERSION=.*|ABADA_VERSION=$VERSION|" \
  "$ROOT_DIR/release/.env.prod.example" >"$STAGING/release/.env.prod.example"
cp "$ROOT_DIR/release/abada-platform" "$ROOT_DIR/release/abada-platform.ps1" "$ROOT_DIR/release/README.md" "$STAGING/release/"
cp -R "$ROOT_DIR/release/samples" "$STAGING/release/"

# Normalize archive metadata so rerunning publication for the same immutable
# tag produces byte-identical assets instead of silently changing the checksum.
find "$STAGING" -exec touch -t 200001010000 {} +
if tar --version 2>/dev/null | grep -q 'GNU tar'; then
  (
    cd "$OUTPUT_DIR"
    find "$BUNDLE_NAME" -print | LC_ALL=C sort | \
      tar -czf "$ARCHIVE" --no-recursion --owner=0 --group=0 --numeric-owner -T -
  )
else
  (
    cd "$OUTPUT_DIR"
    find "$BUNDLE_NAME" -print | LC_ALL=C sort | \
      COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" --no-recursion \
        --uid 0 --gid 0 --uname root --gname root -T -
  )
fi
(
  cd "$OUTPUT_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$BUNDLE_NAME.tar.gz" > "$BUNDLE_NAME.tar.gz.sha256"
  else
    shasum -a 256 "$BUNDLE_NAME.tar.gz" > "$BUNDLE_NAME.tar.gz.sha256"
  fi
)
echo "$ARCHIVE"
