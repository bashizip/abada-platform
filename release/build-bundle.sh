#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:?Usage: ./release/build-bundle.sh VERSION}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || {
  echo "Error: VERSION must be an immutable semantic version, for example 1.0.0-rc.2" >&2
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
  -e "s|^ABADA_TENDA_IMAGE=.*|ABADA_TENDA_IMAGE=ghcr.io/bashizip/abada-tenda:$VERSION|" \
  -e "s|^ABADA_ORUN_IMAGE=.*|ABADA_ORUN_IMAGE=ghcr.io/bashizip/abada-orun:$VERSION|" \
  "$ROOT_DIR/release/.env.dev.example" >"$STAGING/release/.env.dev.example"
sed "s|^ABADA_VERSION=.*|ABADA_VERSION=$VERSION|" \
  "$ROOT_DIR/release/.env.prod.example" >"$STAGING/release/.env.prod.example"
cp "$ROOT_DIR/release/abada-platform" "$ROOT_DIR/release/abada-platform.ps1" "$ROOT_DIR/release/README.md" "$STAGING/release/"
cp -R "$ROOT_DIR/release/samples" "$STAGING/release/"

tar -C "$OUTPUT_DIR" -czf "$ARCHIVE" "$BUNDLE_NAME"
(
  cd "$OUTPUT_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$BUNDLE_NAME.tar.gz" > "$BUNDLE_NAME.tar.gz.sha256"
  else
    shasum -a 256 "$BUNDLE_NAME.tar.gz" > "$BUNDLE_NAME.tar.gz.sha256"
  fi
)
echo "$ARCHIVE"
