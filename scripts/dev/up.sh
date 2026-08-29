#!/usr/bin/env bash
#
# Start the full Abada development stack with local Engine and Studio images.
#
# Usage:
#   ./scripts/dev/up.sh               # full dev stack, including the local agent worker
#   ./scripts/dev/up.sh --no-agent    # core stack only (diagnostics)
#   ./scripts/dev/up.sh --agent-image ghcr.io/bashizip/abada-agent-worker:1.0.0-rc.3
#                                      # use a pinned remote agent image instead of the local build
#   ./scripts/dev/up.sh --telemetry     # also enable the bundled telemetry overlay
#   ./scripts/dev/up.sh --telemetry --no-agent
#
# The script first brings up the base stack, provisions Keycloak + Engine for
# the first-party worker, then starts the worker. That ordering avoids a
# cold-realm race where the worker tries to authenticate before its
# confidential client exists.
#
# By default, the worker image is built locally from `agent-worker/Dockerfile`
# and tagged as `abada-agent-worker:local`. Source changes trigger an automatic
# rebuild on the next `up.sh`. Use `--agent-image <ref>` to swap to a
# pinned image (for example for production-parity tests).
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ABADA_ENV_FILE:-$ROOT_DIR/.env.dev}"
ENGINE_IMAGE="${ABADA_LOCAL_ENGINE_IMAGE:-abada-engine:local}"
STUDIO_IMAGE="${ABADA_LOCAL_STUDIO_IMAGE:-abada-studio:local}"
AGENT=true
TELEMETRY=false
AGENT_IMAGE_OPT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT=true ;; # retained for command-line compatibility
    --no-agent) AGENT=false ;;
    --telemetry) TELEMETRY=true ;;
    --agent-image)
      [[ $# -ge 2 ]] || { echo "Error: --agent-image requires an image reference" >&2; exit 2; }
      AGENT_IMAGE_OPT="$2"
      AGENT=true
      shift
      ;;
    -h|--help) sed -n '3,20p' "$0"; exit 0 ;;
    *) echo "Error: unknown option '$1'" >&2; exit 2 ;;
  esac
  shift
done

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/release/.env.dev.example" "$ENV_FILE"
fi

update_image_var() {
  if grep -q "^${1}=" "$ENV_FILE"; then
    sed -i '' "s|^${1}=.*|${1}=${2}|" "$ENV_FILE"
  else
    echo "${1}=${2}" >> "$ENV_FILE"
  fi
}
update_image_var ABADA_ENGINE_IMAGE "$ENGINE_IMAGE"
update_image_var ABADA_STUDIO_IMAGE "$STUDIO_IMAGE"

if $AGENT; then
  AGENT_IMAGE_VALUE="${AGENT_IMAGE_OPT:-abada-agent-worker:local}"
  update_image_var ABADA_AGENT_WORKER_IMAGE "$AGENT_IMAGE_VALUE"
fi

BASE_FLAGS=(--no-pull)
$TELEMETRY && BASE_FLAGS+=(--telemetry)

if ! $AGENT; then
  "$ROOT_DIR/release/abada-platform" up dev --no-agent "${BASE_FLAGS[@]}"
  exit 0
fi

# Start the dependencies first. The worker needs the Keycloak client and global
# engine worker registration below, so starting it before provisioning creates a
# cold-stack race.
"$ROOT_DIR/release/abada-platform" up dev --no-agent "${BASE_FLAGS[@]}"

echo "Provisioning the agent worker (Keycloak client + global capability registration)..."
"$ROOT_DIR/scripts/dev/provision-agent-worker.sh"

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml" --profile agent)

# Remove a stale stopped worker before recreating it. `docker compose down`
# without the agent profile can leave profile-gated containers attached to an
# old network after `clean.sh`; attempting to start that stale container yields
# "network ... not found".
"${COMPOSE[@]}" rm -sf abada-agent-worker >/dev/null 2>&1 || true

echo "Starting the agent worker..."
if [[ -z "$AGENT_IMAGE_OPT" ]]; then
  "${COMPOSE[@]}" up -d --build --wait abada-agent-worker
else
  "${COMPOSE[@]}" up -d --wait abada-agent-worker
fi

echo "Agent worker is ready."
