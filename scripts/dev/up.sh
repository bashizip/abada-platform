#!/usr/bin/env bash
#
# Build all local Docker images and start the full Abada dev stack.
#
# Usage:
#   ./scripts/dev/up.sh               # build all images + full dev stack with agent worker
#   ./scripts/dev/up.sh --no-agent    # build all images + core stack only (diagnostics)
#   ./scripts/dev/up.sh --no-build    # skip builds, just stack up (images must exist)
#   ./scripts/dev/up.sh --no-cache    # rebuild images from scratch (no Docker layer cache)
#   ./scripts/dev/up.sh --agent-image ghcr.io/bashizip/abada-agent-worker:1.0.0-rc.6
#                                      # use a pinned remote agent image instead of the local build
#   ./scripts/dev/up.sh --telemetry   # also enable the bundled telemetry overlay
#   ./scripts/dev/up.sh --telemetry --no-agent
#
# Images built locally:
#   - abada-engine:local       (engine/Dockerfile.prod.engine)
#   - abada-studio:local       (studio/Dockerfile.prod)
#   - abada-docs:local         (documentation/Dockerfile.prod)
#   - abada-agent-worker:local (agent-worker/Dockerfile)  [unless --no-agent or --agent-image]
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ABADA_ENV_FILE:-$ROOT_DIR/.env.dev}"
ENGINE_IMAGE="${ABADA_LOCAL_ENGINE_IMAGE:-abada-engine:local}"
STUDIO_IMAGE="${ABADA_LOCAL_STUDIO_IMAGE:-abada-studio:local}"
DOCS_IMAGE="${ABADA_LOCAL_DOCS_IMAGE:-abada-docs:local}"
AGENT_IMAGE="${ABADA_LOCAL_AGENT_WORKER_IMAGE:-abada-agent-worker:local}"
AGENT=true
TELEMETRY=false
BUILD=true
NO_CACHE=false
AGENT_IMAGE_OPT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT=true ;;
    --no-agent) AGENT=false ;;
    --telemetry) TELEMETRY=true ;;
    --no-build) BUILD=false ;;
    --no-cache) NO_CACHE=true ;;
    --agent-image)
      [[ $# -ge 2 ]] || { echo "Error: --agent-image requires an image reference" >&2; exit 2; }
      AGENT_IMAGE_OPT="$2"
      AGENT=true
      shift
      ;;
    -h|--help) sed -n '3,24p' "$0"; exit 0 ;;
    *) echo "Error: unknown option '$1'" >&2; exit 2 ;;
  esac
  shift
done

command -v docker >/dev/null 2>&1 || { echo "Error: docker is required" >&2; exit 69; }
docker compose version >/dev/null 2>&1 || { echo "Error: docker compose v2 is required" >&2; exit 69; }
docker info >/dev/null 2>&1 || { echo "Error: Docker daemon is not running" >&2; exit 69; }

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/release/.env.dev.example" "$ENV_FILE"
  echo "Created $ENV_FILE from the safe development defaults."
fi

# Sync defaults that changed between releases so existing .env.dev files
# pick up the new values without manual editing.
sync_default() {
  local key="$1" new_value="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^${key}=.*|${key}=${new_value}|" "$ENV_FILE"
    else
      sed -i "s|^${key}=.*|${key}=${new_value}|" "$ENV_FILE"
    fi
  else
    echo "${key}=${new_value}" >> "$ENV_FILE"
  fi
}
sync_default ABADA_INSIGHT_ENABLED true

update_image_var() {
  local key="$1" value="$2" temp_file
  umask 077
  temp_file="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    index($0, key "=") == 1 {
      if (!updated) print key "=" value
      updated = 1
      next
    }
    { print }
    END { if (!updated) print key "=" value }
  ' "$ENV_FILE" >"$temp_file"
  mv "$temp_file" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

build_flags=()
$NO_CACHE && build_flags+=(--no-cache)

build_images() {
  echo "Building $ENGINE_IMAGE..."
  docker build "${build_flags[@]+"${build_flags[@]}"}" \
    -f "$ROOT_DIR/engine/Dockerfile.prod.engine" -t "$ENGINE_IMAGE" "$ROOT_DIR/engine"

  echo "Building $STUDIO_IMAGE..."
  docker build "${build_flags[@]+"${build_flags[@]}"}" \
    -f "$ROOT_DIR/studio/Dockerfile.prod" -t "$STUDIO_IMAGE" "$ROOT_DIR"

  echo "Building $DOCS_IMAGE..."
  docker build "${build_flags[@]+"${build_flags[@]}"}" \
    -f "$ROOT_DIR/documentation/Dockerfile.prod" -t "$DOCS_IMAGE" "$ROOT_DIR/documentation"

  if $AGENT && [[ -z "$AGENT_IMAGE_OPT" ]]; then
    echo "Building $AGENT_IMAGE..."
    docker build "${build_flags[@]+"${build_flags[@]}"}" \
      -f "$ROOT_DIR/agent-worker/Dockerfile" -t "$AGENT_IMAGE" "$ROOT_DIR"
  fi

  echo "All images built successfully."
}

if $BUILD; then
  build_images
else
  echo "Skipping builds (--no-build). Using existing local images."
fi

update_image_var ABADA_ENGINE_IMAGE "$ENGINE_IMAGE"
update_image_var ABADA_STUDIO_IMAGE "$STUDIO_IMAGE"
update_image_var ABADA_DOCS_IMAGE "$DOCS_IMAGE"

if $AGENT; then
  AGENT_IMAGE_VALUE="${AGENT_IMAGE_OPT:-$AGENT_IMAGE}"
  update_image_var ABADA_AGENT_WORKER_IMAGE "$AGENT_IMAGE_VALUE"
fi

BASE_FLAGS=(--no-pull)
$TELEMETRY && BASE_FLAGS+=(--telemetry)

if ! $AGENT; then
  "$ROOT_DIR/release/abada-platform" up dev --no-agent "${BASE_FLAGS[@]}"
  exit 0
fi

"$ROOT_DIR/release/abada-platform" up dev --no-agent "${BASE_FLAGS[@]}"

echo "Provisioning the agent worker (Keycloak client + global capability registration)..."
"$ROOT_DIR/scripts/dev/provision-agent-worker.sh"

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml" --profile agent)

"${COMPOSE[@]}" rm -sf abada-agent-worker >/dev/null 2>&1 || true

echo "Starting the agent worker..."
if [[ -z "$AGENT_IMAGE_OPT" ]]; then
  "${COMPOSE[@]}" up -d --wait abada-agent-worker
else
  "${COMPOSE[@]}" up -d --wait abada-agent-worker
fi

echo "Agent worker is ready."
