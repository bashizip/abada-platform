#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE_IMAGE="${ABADA_LOCAL_ENGINE_IMAGE:-abada-engine:local}"
STUDIO_IMAGE="${ABADA_LOCAL_STUDIO_IMAGE:-abada-studio:local}"
HEALTH_TIMEOUT_SECONDS="${ABADA_REDEPLOY_HEALTH_TIMEOUT_SECONDS:-180}"
NO_CACHE=false

usage() {
  cat <<'EOF'
Usage: ./scripts/dev/rebuild-engine-studio.sh [--no-cache]

Build the local Engine and Studio production images, then force-recreate only
their development Compose services and wait until both are healthy.

Optional environment variables:
  ABADA_LOCAL_ENGINE_IMAGE                 Engine image tag
  ABADA_LOCAL_STUDIO_IMAGE                 Studio image tag
  ABADA_REDEPLOY_HEALTH_TIMEOUT_SECONDS    Health timeout per service
EOF
}

case "${1:-}" in
  "") ;;
  --no-cache) NO_CACHE=true ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if ! [[ "$HEALTH_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ABADA_REDEPLOY_HEALTH_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Required command not found: docker" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not available. Start Docker Desktop or the Docker daemon first." >&2
  exit 1
fi

COMPOSE=(docker compose -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml")

wait_for_health() {
  local service="$1"
  local container_id status deadline

  container_id="$("${COMPOSE[@]}" ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    echo "Compose did not create a container for $service." >&2
    return 1
  fi

  deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    case "$status" in
      healthy)
        echo "✓ $service is healthy"
        return 0
        ;;
      unhealthy|exited|dead)
        echo "$service entered state: $status" >&2
        "${COMPOSE[@]}" logs --tail=80 "$service" >&2
        return 1
        ;;
    esac
    sleep 2
  done

  echo "Timed out waiting for $service to become healthy." >&2
  "${COMPOSE[@]}" logs --tail=80 "$service" >&2
  return 1
}

build_image() {
  local dockerfile="$1"
  local image="$2"
  local context="$3"

  if [[ "$NO_CACHE" == true ]]; then
    docker build --no-cache -f "$dockerfile" -t "$image" "$context"
  else
    docker build -f "$dockerfile" -t "$image" "$context"
  fi
}

echo "Building $ENGINE_IMAGE..."
build_image "$ROOT_DIR/engine/Dockerfile.prod.engine" "$ENGINE_IMAGE" "$ROOT_DIR/engine"

echo "Building $STUDIO_IMAGE..."
build_image "$ROOT_DIR/studio/Dockerfile.prod" "$STUDIO_IMAGE" "$ROOT_DIR/studio"

export ABADA_ENGINE_IMAGE="$ENGINE_IMAGE"
export ABADA_STUDIO_IMAGE="$STUDIO_IMAGE"

"${COMPOSE[@]}" config --quiet

echo "Recreating only abada-engine and abada-studio..."
"${COMPOSE[@]}" up -d --no-deps --force-recreate abada-engine abada-studio

wait_for_health abada-engine
wait_for_health abada-studio

echo
"${COMPOSE[@]}" ps abada-engine abada-studio
echo "Engine and Studio rebuilt and redeployed successfully."
