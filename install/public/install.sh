#!/usr/bin/env bash
set -euo pipefail

# Abada Platform Installer
# Usage: curl -fsSL https://install.abadaplatform.com/install.sh | bash
#
# Downloads the release archive, verifies its SHA-256 checksum,
# extracts it, and starts the development stack.

VERSION="${ABADA_VERSION:-}"
INSTALL_DIR="${ABADA_INSTALL_DIR:-$PWD/abada-platform}"
BASE_URL="${ABADA_RELEASE_BASE_URL:-https://install.abadaplatform.com}"
BASE_URL="${BASE_URL%/}"

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

if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  fail "'sha256sum' or 'shasum' is required but not installed."
fi

# Verify Docker daemon is reachable
docker info >/dev/null 2>&1 || fail "Docker daemon is not running. Start Docker Desktop or the Docker service and try again."

# A real provider key is mandatory for the default starter. Read from /dev/tty
# because stdin contains this script when invoked through `curl | bash`.
GEMINI_KEY="${ABADA_AGENT_LLM_API_KEY:-}"
if [[ -z "$GEMINI_KEY" ]]; then
  if [[ -r /dev/tty && -w /dev/tty ]]; then
    printf 'Gemini API key (input hidden): ' >/dev/tty
    IFS= read -r -s GEMINI_KEY </dev/tty
    printf '\n' >/dev/tty
  else
    fail "A Gemini API key is required. Set ABADA_AGENT_LLM_API_KEY for non-interactive installation."
  fi
fi
[[ "$GEMINI_KEY" =~ ^[A-Za-z0-9_-]{20,}$ ]] || fail "The Gemini API key has an invalid format."

# Resolve the public pointer only when the caller did not request an exact
# immutable version. The release workflow updates this object after the bundle,
# checksum, public images, and clean-machine installation have all passed.
if [[ -z "$VERSION" ]]; then
  info "Resolving the latest published Abada release ..."
  if ! VERSION="$(curl -fsSL --retry 3 --retry-delay 2 "${BASE_URL}/latest")"; then
    fail "Could not resolve the latest release from ${BASE_URL}/latest."
  fi
fi

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || \
  fail "ABADA_VERSION must be an exact immutable semantic version (for example 1.0.0-rc.5)."

ARCHIVE="abada-platform-${VERSION}.tar.gz"
DOWNLOAD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/abada-install.XXXXXX")"
cleanup() {
  rm -rf "$DOWNLOAD_DIR"
}
trap cleanup EXIT

# Keep the credential out of process arguments and diagnostics while proving
# that the selected model is reachable before any containers are started.
GEMINI_CONFIG="${DOWNLOAD_DIR}/gemini.curl.conf"
GEMINI_RESPONSE="${DOWNLOAD_DIR}/gemini-response.json"
umask 077
printf 'header = "Authorization: Bearer %s"\n' "$GEMINI_KEY" >"$GEMINI_CONFIG"
printf 'header = "Content-Type: application/json"\n' >>"$GEMINI_CONFIG"
printf 'data = "{\\"model\\":\\"gemini-3.6-flash\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Reply with exactly READY\\"}],\\"temperature\\":0,\\"max_tokens\\":64}"\n' >>"$GEMINI_CONFIG"
info "Validating Gemini 3.6 Flash access ..."
GEMINI_HTTP_STATUS="$(curl --silent --show-error --config "$GEMINI_CONFIG" \
  --request POST 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' \
  --output "$GEMINI_RESPONSE" --write-out '%{http_code}')" || fail "Could not reach the Gemini API."
[[ "$GEMINI_HTTP_STATUS" == 2* ]] || fail "Gemini rejected the supplied credential (HTTP ${GEMINI_HTTP_STATUS})."
grep -q '"content"' "$GEMINI_RESPONSE" || fail "Gemini returned no assistant response for gemini-3.6-flash."
ok "Gemini 3.6 Flash is ready."

# --- download ----------------------------------------------------------------

info "Downloading Abada ${VERSION} ..."
curl -fSL --retry 3 --retry-delay 2 "${BASE_URL}/${ARCHIVE}" -o "${DOWNLOAD_DIR}/${ARCHIVE}"
curl -fSL --retry 3 --retry-delay 2 "${BASE_URL}/${ARCHIVE}.sha256" -o "${DOWNLOAD_DIR}/${ARCHIVE}.sha256"

# --- verify ------------------------------------------------------------------

info "Verifying SHA-256 checksum ..."
CHECKSUM_FILE="${DOWNLOAD_DIR}/${ARCHIVE}.sha256"
CHECKSUM_LINE="$(cat "$CHECKSUM_FILE")"
[[ "$(awk 'END { print NR }' "$CHECKSUM_FILE")" == "1" ]] || \
  fail "Checksum file must contain exactly one entry."
[[ "$CHECKSUM_LINE" =~ ^([0-9a-fA-F]{64})[[:space:]][[:space:]](.+)$ ]] || \
  fail "Checksum file has an invalid format."
[[ "${BASH_REMATCH[2]}" == "$ARCHIVE" ]] || \
  fail "Checksum file names an unexpected archive."
(
  cd "$DOWNLOAD_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check "${ARCHIVE}.sha256"
  else
    shasum -a 256 --check "${ARCHIVE}.sha256"
  fi
) || fail "Checksum verification failed. The download may be corrupted."
ok "Checksum verified."

# --- extract -----------------------------------------------------------------

info "Extracting archive ..."
mkdir -p "$INSTALL_DIR"
tar -xzf "${DOWNLOAD_DIR}/${ARCHIVE}" --strip-components=1 -C "$INSTALL_DIR"

# Materialize the safe development template and inject only the local provider
# configuration. The resulting file is intentionally untracked and mode 0600.
ENV_FILE="${INSTALL_DIR}/.env.dev"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "${INSTALL_DIR}/release/.env.dev.example" "$ENV_FILE"
fi
set_env_value() {
  local key="$1" value="$2" temporary line updated=false
  temporary="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  chmod 600 "$temporary"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "$key="* ]]; then
      if [[ "$updated" == false ]]; then
        printf '%s=%s\n' "$key" "$value" >>"$temporary"
        updated=true
      fi
    else
      printf '%s\n' "$line" >>"$temporary"
    fi
  done <"$ENV_FILE"
  if [[ "$updated" == false ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$temporary"
  fi
  mv "$temporary" "$ENV_FILE"
}
set_env_value ABADA_AGENT_LLM_API_KEY "$GEMINI_KEY"
set_env_value ABADA_AGENT_OPENAI_API_KEY "$GEMINI_KEY"
set_env_value ABADA_LLM_API_KEY "$GEMINI_KEY"
set_env_value ABADA_LLM_BASE_URL "https://generativelanguage.googleapis.com/v1beta/openai"
set_env_value ABADA_LLM_MODEL "gemini-3.6-flash"
set_env_value ABADA_INSIGHT_ENABLED "true"
set_env_value ABADA_STARTER_WORKFLOW_ENABLED "true"
chmod 600 "$ENV_FILE"
unset GEMINI_KEY

# --- start -------------------------------------------------------------------

info "Starting Abada development stack ..."
"${INSTALL_DIR}/release/abada-platform" up dev

ok "Abada ${VERSION} is running."
echo ""
echo "  Studio:  http://studio.localhost"
echo "  Engine:  http://api.localhost/api/v1/info"
echo "  Keycloak: http://keycloak.localhost"
echo ""
echo "  Login: alice / alice"
echo ""
echo "  Manage: ${INSTALL_DIR}/release/abada-platform {status|logs|down} dev"
