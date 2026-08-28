#!/usr/bin/env bash
#
# Build the local Engine and Studio production images from the current working
# tree and restart only those two Compose services. All other services
# (PostgreSQL, Keycloak, Docs, etc.) keep running.
#
# Usage:
#   ./scripts/dev/rebuild.sh           # incremental build
#   ./scripts/dev/rebuild.sh --no-cache  # force clean Docker build layers
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE_IMAGE="${ABADA_LOCAL_ENGINE_IMAGE:-abada-engine:local}"
STUDIO_IMAGE="${ABADA_LOCAL_STUDIO_IMAGE:-abada-studio:local}"
ENV_FILE="${ABADA_ENV_FILE:-$ROOT_DIR/.env.dev}"
HEALTH_TIMEOUT="${ABADA_REDEPLOY_HEALTH_TIMEOUT_SECONDS:-180}"
NO_CACHE=false

case "${1:-}" in
  "") ;;
  --no-cache) NO_CACHE=true ;;
  -h|--help) sed -n '3,11p' "$0"; exit 0 ;;
  *) echo "Usage: $0 [--no-cache]" >&2; exit 2 ;;
esac

command -v docker >/dev/null 2>&1 || { echo "Error: docker is required" >&2; exit 69; }
docker compose version >/dev/null 2>&1 || { echo "Error: docker compose v2 is required" >&2; exit 69; }
docker info >/dev/null 2>&1 || { echo "Error: Docker daemon is not running" >&2; exit 69; }

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/release/.env.dev.example" "$ENV_FILE"
  echo "Created $ENV_FILE from the safe development defaults."
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

build_flags=()
$NO_CACHE && build_flags+=(--no-cache)

echo "Building $ENGINE_IMAGE..."
docker build "${build_flags[@]+"${build_flags[@]}"}" -f "$ROOT_DIR/engine/Dockerfile.prod.engine" -t "$ENGINE_IMAGE" "$ROOT_DIR/engine"

echo "Building $STUDIO_IMAGE..."
docker build "${build_flags[@]+"${build_flags[@]}"}" -f "$ROOT_DIR/studio/Dockerfile.prod" -t "$STUDIO_IMAGE" "$ROOT_DIR"

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml")

"${COMPOSE[@]}" config --quiet

wait_for_health() {
  local service="$1" container_id status deadline
  container_id="$("${COMPOSE[@]}" ps -q "$service")"
  [[ -n "$container_id" ]] || { echo "Compose did not create a container for $service" >&2; return 1; }
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    case "$status" in
      healthy) echo "✓ $service is healthy"; return 0 ;;
      unhealthy|exited|dead)
        echo "$service entered state: $status" >&2; "${COMPOSE[@]}" logs --tail=40 "$service" >&2; return 1 ;;
    esac
    sleep 2
  done
  echo "Timed out waiting for $service to become healthy." >&2
  "${COMPOSE[@]}" logs --tail=40 "$service" >&2
  return 1
}

echo "Recreating only abada-engine and abada-studio..."
"${COMPOSE[@]}" up -d --no-deps --force-recreate abada-engine abada-studio

wait_for_health abada-engine
wait_for_health abada-studio

echo
"${COMPOSE[@]}" ps abada-engine abada-studio
echo "Engine and Studio rebuilt and redeployed successfully."
