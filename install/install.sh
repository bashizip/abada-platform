#!/usr/bin/env bash
set -euo pipefail

# Abada Platform Installer
# Usage: curl -fsSL https://install.abadaplatform.com/install.sh | bash
#
# Downloads the release archive, verifies its SHA-256 checksum,
# extracts it, and starts the development stack.
#
# Anonymous install report: when it finishes, the installer sends ONE event to
# install.abadaplatform.com (version, OS, CPU architecture, Docker version,
# outcome and, on failure, the step; your country and region come from your IP
# address at the receiving end, which is not stored). Nothing else leaves your
# machine and the running platform sends nothing. Turn it off with
#   ABADA_USAGE_PING=0   (for the pipeline: curl ... | ABADA_USAGE_PING=0 bash)
# or DO_NOT_TRACK=1. Details: https://docs.abadaplatform.com/user/privacy/

VERSION="${ABADA_VERSION:-}"
INSTALL_DIR="${ABADA_INSTALL_DIR:-$PWD/abada-platform}"
BASE_URL="${ABADA_RELEASE_BASE_URL:-https://install.abadaplatform.com}"
BASE_URL="${BASE_URL%/}"
DEFAULT_BASE_URL="https://install.abadaplatform.com"
USAGE_ENDPOINT="${ABADA_USAGE_ENDPOINT:-${DEFAULT_BASE_URL}/v1/install-event}"
STARTED_AT=$SECONDS
STEP="preflight"

info()  { printf '\033[1;34m[info]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[1;32m[ok]\033[0m    %s\n' "$*"; }
warn()  { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is required but not installed."
}

# --- anonymous install report --------------------------------------------------

# Enabled unless the user opted out. Mirrors and tests (a non-default release
# base URL) never report, unless a test names an endpoint explicitly.
usage_ping_enabled() {
  case "${ABADA_USAGE_PING:-1}" in 0|false|FALSE|no|NO|off|OFF) return 1 ;; esac
  case "${DO_NOT_TRACK:-}" in ""|0) ;; *) return 1 ;; esac
  [[ -n "${ABADA_USAGE_ENDPOINT:-}" || "$BASE_URL" == "$DEFAULT_BASE_URL" ]] || return 1
  return 0
}

# Only characters that are safe inside a JSON string and never a path or a name.
usage_clean() { printf '%s' "$1" | tr -cd 'A-Za-z0-9._+-' | cut -c1-40; }

# A random id made here, not derived from the machine; it lets the outcome of
# one install be told apart from another. Kept next to the install (mode 0600).
usage_install_id() {
  local file="${INSTALL_DIR}/.abada-install-id" id=""
  if [[ -r "$file" ]]; then id="$(tr -cd '0-9a-f-' <"$file" | cut -c1-40)"; fi
  if [[ ${#id} -lt 16 ]]; then
    if command -v uuidgen >/dev/null 2>&1; then id="$(uuidgen | tr 'A-F' 'a-f')"
    else id="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"; fi
    if [[ -d "$INSTALL_DIR" ]]; then ( umask 077; printf '%s\n' "$id" >"$file" ) 2>/dev/null || true; fi
  fi
  printf '%s' "$id"
}

# Called once, from the exit trap, with the installer's exit status. It can never
# change that status or hold the installer up: a short timeout, errors ignored.
send_usage_event() {
  local status="$1"
  usage_ping_enabled || return 0
  local event="install_succeeded" payload docker_version version
  [[ "$status" -eq 0 ]] || event="install_failed"
  docker_version="$(usage_clean "$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)")"
  version="${VERSION:-}"
  payload="{\"event\":\"${event}\""
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*$ ]] && payload+=",\"version\":\"${version}\""
  payload+=",\"install_id\":\"$(usage_install_id)\""
  payload+=",\"os\":\"$(usage_clean "$(uname -s 2>/dev/null || true)")\""
  payload+=",\"arch\":\"$(usage_clean "$(uname -m 2>/dev/null || true)")\""
  [[ -n "$docker_version" ]] && payload+=",\"docker_version\":\"${docker_version}\""
  payload+=",\"profile\":\"dev\",\"duration_s\":$(( SECONDS - STARTED_AT ))"
  if [[ -n "${GEMINI_KEY:-}" || "${GEMINI_KEY_SET:-}" == "1" ]]; then payload+=",\"llm_key_provided\":true"; else payload+=",\"llm_key_provided\":false"; fi
  if [[ -n "${CI:-}" ]]; then payload+=",\"ci\":true"; else payload+=",\"ci\":false"; fi
  [[ "$event" == "install_failed" ]] && payload+=",\"failed_step\":\"${STEP}\""
  payload+="}"
  curl -m 3 --retry 0 -fsS -o /dev/null -X POST -H 'Content-Type: application/json' \
    --data "$payload" "$USAGE_ENDPOINT" >/dev/null 2>&1 || true
}

if usage_ping_enabled; then
  info "When it finishes, this installer sends one anonymous report to install.abadaplatform.com:"
  info "version, OS, CPU architecture, Docker version, outcome. Your country and region come from"
  info "your IP address, which is not stored. Opt out: ABADA_USAGE_PING=0 or DO_NOT_TRACK=1."
fi

# Runs on every exit, including a failed preflight: removes the download directory and sends the one
# report (if enabled).
DOWNLOAD_DIR=""
cleanup() {
  local status=$?
  set +e
  [[ -z "$DOWNLOAD_DIR" ]] || rm -rf "$DOWNLOAD_DIR"
  send_usage_event "$status"
  exit "$status"   # whatever the report did, the installer's own status is what the caller sees
}
trap cleanup EXIT

# Everything below runs as one block. With `curl ... | bash`, bash reads this
# script from stdin while it runs; a command that also reads stdin (such as
# `docker compose exec`) would otherwise swallow the rest of the script, and the
# installer would stop silently before its final instructions.
{

# --- preflight ---------------------------------------------------------------

require_cmd curl
require_cmd tar
require_cmd docker

if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  fail "'sha256sum' or 'shasum' is required but not installed."
fi

# Verify Docker daemon is reachable
docker info >/dev/null 2>&1 || fail "Docker daemon is not running. Start Docker Desktop or the Docker service and try again."

# The provider key is optional. Headless installs may set ABADA_LLM_GEMINI_API_KEY
# (ABADA_AGENT_LLM_API_KEY is still accepted); everyone else can add the key
# after startup in Studio → Settings → AI Providers, which stores it
# AES-encrypted in the database and serves agents and Insight alike — the
# recommended path. Installation must never block on it.
GEMINI_KEY="${ABADA_LLM_GEMINI_API_KEY:-${ABADA_AGENT_LLM_API_KEY:-}}"
STEP="validate_key"
if [[ -n "$GEMINI_KEY" ]]; then
  # Trim whitespace, quotes and carriage returns that terminals and editors
  # commonly introduce when pasting keys.
  GEMINI_KEY="$(printf '%s' "$GEMINI_KEY" | tr -d '[:space:]"'"'")"
  [[ "$GEMINI_KEY" =~ ^[A-Za-z0-9_-]{20,}$ ]] || fail "The Gemini API key has an invalid format. Expected 20+ characters of letters, digits, underscore or dash (got ${#GEMINI_KEY} characters after cleanup)."
fi

# Resolve the public pointer only when the caller did not request an exact
# immutable version. The release workflow updates this object after the bundle,
# checksum, public images, and clean-machine installation have all passed.
STEP="resolve"
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

# If a key was provided, prove it works before starting containers so a typo
# fails fast instead of surfacing later as failed agent/insight calls.
if [[ -n "$GEMINI_KEY" ]]; then
  # Keep the credential out of process arguments and diagnostics.
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
else
  info "No API key provided — add one later in Studio → Settings (stored encrypted in the database)."
fi

# --- download ----------------------------------------------------------------

STEP="download"
info "Downloading Abada ${VERSION} ..."
curl -fSL --retry 3 --retry-delay 2 "${BASE_URL}/${ARCHIVE}" -o "${DOWNLOAD_DIR}/${ARCHIVE}"
curl -fSL --retry 3 --retry-delay 2 "${BASE_URL}/${ARCHIVE}.sha256" -o "${DOWNLOAD_DIR}/${ARCHIVE}.sha256"

# --- verify ------------------------------------------------------------------

STEP="verify"
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

STEP="extract"
info "Extracting archive ..."
mkdir -p "$INSTALL_DIR"
tar -xzf "${DOWNLOAD_DIR}/${ARCHIVE}" --strip-components=1 -C "$INSTALL_DIR"

STEP="configure"

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
if [[ -n "$GEMINI_KEY" ]]; then
  # One key, read by the engine for agents, Insight and authoring.
  set_env_value ABADA_LLM_GEMINI_API_KEY "$GEMINI_KEY"
fi
set_env_value ABADA_LLM_MODEL "gemini-3.6-flash"
set_env_value ABADA_INSIGHT_ENABLED "true"
set_env_value ABADA_INSIGHT_LLM_TIMEOUT_MS "90000"
set_env_value ABADA_STARTER_WORKFLOW_ENABLED "true"
chmod 600 "$ENV_FILE"
[[ -n "$GEMINI_KEY" ]] && GEMINI_KEY_SET=1
unset GEMINI_KEY

# --- start -------------------------------------------------------------------

STEP="start"
info "Starting Abada development stack ..."
"${INSTALL_DIR}/release/abada-platform" up dev </dev/null

ok "Abada ${VERSION} is running."
echo ""
echo "  Studio:  http://studio.localhost"
echo "  Engine:  http://api.localhost/api/v1/info"
echo "  Keycloak: http://keycloak.localhost"
echo ""
echo "  Initialize: alice / alice"
echo "  HIGH review: bob / bob"
echo ""
if [[ "${GEMINI_KEY_SET:-}" != "1" ]]; then
  echo "  Gemini key: not set. Agent steps need a model key: add it in Studio → Settings → AI Providers"
  echo "              (stored encrypted), or re-run with: curl ... | ABADA_LLM_GEMINI_API_KEY=<key> bash"
fi
echo ""
echo "  Manage: ${INSTALL_DIR}/release/abada-platform {status|logs|down} dev"

}
