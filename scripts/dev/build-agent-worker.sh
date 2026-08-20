#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_WORKER_IMAGE="${ABADA_LOCAL_AGENT_WORKER_IMAGE:-abada-agent-worker:local}"
ENV_FILE="${ABADA_ENV_FILE:-$ROOT_DIR/.env.dev}"
HEALTH_TIMEOUT_SECONDS="${ABADA_REDEPLOY_HEALTH_TIMEOUT_SECONDS:-180}"
NO_CACHE=false

usage() {
  cat <<'EOF'
Usage: ./scripts/dev/build-agent-worker.sh [--no-cache]

Build the local first-party abada:agent worker image, then force-recreate the
agent Compose service and wait until it is healthy. The image build installs
the local SDK snapshot (sdk/java) and packages the worker from source, so it
always reflects the current working tree.

NOTE: `./scripts/dev/up.sh --agent` now does this automatically as part of
the single-command workflow (it relies on Docker Compose's `build:` directive
on the `abada-agent-worker` service in `compose.yaml`). Use this script only
when you need an explicit rebuild outside of `up.sh`, for example with
`--no-cache` after changing the base image or to publish a developer build.

Optional environment variables:
  ABADA_LOCAL_AGENT_WORKER_IMAGE          Agent worker image tag
  ABADA_ENV_FILE                         Compose environment file (default .env.dev)
  ABADA_REDEPLOY_HEALTH_TIMEOUT_SECONDS   Health timeout per service
EOF
}

case "${1:-}" in
  "")
    ;;
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

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: environment file not found: $ENV_FILE" >&2
  echo "Create it from release/.env.dev.example or start the stack first." >&2
  exit 66
fi

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml" --profile agent)

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

if [[ "$NO_CACHE" == true ]]; then
  docker build --no-cache -f "$ROOT_DIR/agent-worker/Dockerfile" -t "$AGENT_WORKER_IMAGE" "$ROOT_DIR"
else
  docker build -f "$ROOT_DIR/agent-worker/Dockerfile" -t "$AGENT_WORKER_IMAGE" "$ROOT_DIR"
fi

export ABADA_AGENT_WORKER_IMAGE="$AGENT_WORKER_IMAGE"

"${COMPOSE[@]}" config --quiet

echo "Recreating abada-agent-worker with $AGENT_WORKER_IMAGE..."
"${COMPOSE[@]}" up -d --no-deps --force-recreate abada-agent-worker

wait_for_health abada-agent-worker

echo
"${COMPOSE[@]}" ps abada-agent-worker
echo "Agent worker rebuilt and redeployed successfully."
