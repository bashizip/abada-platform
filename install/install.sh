#!/usr/bin/env bash
set -euo pipefail

# Abada Platform Installer
# Usage: curl -fsSL https://install.abadaengine.com | bash
#
# Downloads the release archive from GitHub, verifies its SHA-256 checksum,
# extracts it, and starts the development stack.

VERSION="${ABADA_VERSION:-1.0.0-rc.3}"
REPOSITORY="${ABADA_REPOSITORY:-bashizip/abada-engine}"
INSTALL_DIR="${ABADA_INSTALL_DIR:-$PWD/abada-platform}"
ARCHIVE="abada-platform-${VERSION}.tar.gz"
BASE_URL="${ABADA_RELEASE_BASE_URL:-https://github.com/${REPOSITORY}/releases/download/v${VERSION}}"

info()  { printf '\033[1;34m[info]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[1;32m[ok]\033[0m    %s\n' "$*"; }
warn()  { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is required but not installed."
}

# --- preflight ---------------------------------------------------------------

require_cmd curl
require_cmd tar
require_cmd docker

# Verify Docker daemon is reachable
docker info >/dev/null 2>&1 || fail "Docker daemon is not running. Start Docker Desktop or the Docker service and try again."

# --- download ----------------------------------------------------------------

info "Downloading Abada ${VERSION} ..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

curl -fSLO "${BASE_URL}/${ARCHIVE}"
curl -fSLO "${BASE_URL}/${ARCHIVE}.sha256"

# --- verify ------------------------------------------------------------------

info "Verifying SHA-256 checksum ..."
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum --check "${ARCHIVE}.sha256" || fail "Checksum verification failed. The download may be corrupted."
else
  shasum -a 256 --check "${ARCHIVE}.sha256" || fail "Checksum verification failed. The download may be corrupted."
fi
ok "Checksum verified."

# --- extract -----------------------------------------------------------------

info "Extracting archive ..."
tar -xzf "${ARCHIVE}" --strip-components=1
rm -f "${ARCHIVE}" "${ARCHIVE}.sha256"

# --- start -------------------------------------------------------------------

info "Starting Abada development stack ..."
./release/abada-platform up dev

ok "Abada ${VERSION} is running."
echo ""
echo "  Studio:  http://studio.localhost"
echo "  Engine:  http://api.localhost/api/v1/info"
echo "  Keycloak: http://keycloak.localhost"
echo ""
echo "  Login: alice / alice"
echo ""
echo "  Manage: ./release/abada-platform {status|logs|down} dev"
