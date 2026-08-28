#!/usr/bin/env bash
set -euo pipefail

VERSION="${ABADA_VERSION:-${1:-1.0.0-rc.3}}"
PROFILE="${ABADA_PROFILE:-dev}"
REPOSITORY="${ABADA_REPOSITORY:-bashizip/abada-engine}"
INSTALL_DIR="${ABADA_INSTALL_DIR:-$PWD/abada-platform-$VERSION}"
ARCHIVE="abada-platform-$VERSION.tar.gz"
BASE_URL="${ABADA_RELEASE_BASE_URL:-https://github.com/$REPOSITORY/releases/download/v$VERSION}"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || {
  echo "Error: version must be an immutable semantic version" >&2
  exit 64
}
[[ "$PROFILE" == "dev" || "$PROFILE" == "prod" ]] || {
  echo "Error: ABADA_PROFILE must be dev or prod" >&2
  exit 64
}

command -v docker >/dev/null 2>&1 || { echo "Error: Docker is required" >&2; exit 69; }
docker compose version >/dev/null
command -v curl >/dev/null 2>&1 || { echo "Error: curl is required" >&2; exit 69; }

if [[ "$VERSION" == "1.0.0-rc.1" ]]; then
  docker_arch="$(docker info --format '{{.Architecture}}')"
  if [[ "$docker_arch" == "arm64" || "$docker_arch" == "aarch64" ]]; then
    export DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"
    cat >&2 <<'NOTICE'
Notice: Abada 1.0.0-rc.1 images were published for linux/amd64 only.
This ARM host will run that immutable release through Docker compatibility mode.
NOTICE
  fi
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading Abada $VERSION release bundle..."
curl --fail --location --silent --show-error "$BASE_URL/$ARCHIVE" -o "$TMP_DIR/$ARCHIVE"
curl --fail --location --silent --show-error "$BASE_URL/$ARCHIVE.sha256" -o "$TMP_DIR/$ARCHIVE.sha256"

(
  cd "$TMP_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check "$ARCHIVE.sha256"
  else
    shasum -a 256 --check "$ARCHIVE.sha256"
  fi
)

mkdir -p "$INSTALL_DIR"
tar -xzf "$TMP_DIR/$ARCHIVE" --strip-components=1 -C "$INSTALL_DIR"

echo "Verified and installed Abada at $INSTALL_DIR"
if [[ "$PROFILE" == "dev" ]]; then
  echo "Starting the local HTTP development platform..."
  exec "$INSTALL_DIR/release/abada-platform" up dev
fi

PROD_ENV="$INSTALL_DIR/.env.prod"
if [[ ! -f "$PROD_ENV" ]]; then
  cp "$INSTALL_DIR/release/.env.prod.example" "$PROD_ENV"
fi
cat <<EOF
Production files are ready, but no services were started.
1. Replace every placeholder in $PROD_ENV.
2. Validate: $INSTALL_DIR/release/abada-platform doctor prod --env-file $PROD_ENV
3. Start:    $INSTALL_DIR/release/abada-platform up prod --env-file $PROD_ENV
EOF
