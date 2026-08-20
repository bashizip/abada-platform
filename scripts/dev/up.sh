#!/usr/bin/env bash
#
# Start the full Abada development stack with local Engine and Studio images.
#
# Usage:
#   ./scripts/dev/up.sh               # standard dev stack
#   ./scripts/dev/up.sh --agent        # also start + auto-provision the agent worker
#   ./scripts/dev/up.sh --telemetry     # also enable the bundled telemetry overlay
#   ./scripts/dev/up.sh --agent --telemetry
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ABADA_ENV_FILE:-$ROOT_DIR/.env.dev}"
ENGINE_IMAGE="${ABADA_LOCAL_ENGINE_IMAGE:-abada-engine:local}"
STUDIO_IMAGE="${ABADA_LOCAL_STUDIO_IMAGE:-abada-studio:local}"
AGENT=false
TELEMETRY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT=true ;;
    --telemetry) TELEMETRY=true ;;
    -h|--help) sed -n '3,9p' "$0"; exit 0 ;;
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

FLAGS=(--no-pull)
$AGENT     && FLAGS+=(--agent)
$TELEMETRY && FLAGS+=(--telemetry)

"$ROOT_DIR/release/abada-platform" up dev "${FLAGS[@]}"

if $AGENT; then
  echo "Provisioning the agent worker (Keycloak client + project binding)..."
  "$ROOT_DIR/scripts/dev/provision-agent-worker.sh"
fi
