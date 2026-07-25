#!/bin/bash

# Recreate Abada Tenda container in the dev stack.
# Builds one local immutable image, then recreates the service through the
# canonical development Compose profile.

set -euo pipefail

SERVICE_NAME="abada-tenda"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TENDA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${TENDA_DIR}/.." && pwd)"
COMPOSE_BASE="${ROOT_DIR}/compose.yaml"
COMPOSE_DEV="${ROOT_DIR}/compose.dev.yaml"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--no-build] [--no-cache]

Options:
  --no-build   Recreate container without rebuilding image
  --no-cache   Rebuild image without cache (ignored with --no-build)
  -h, --help   Show this help

Examples:
  $(basename "$0")
  $(basename "$0") --no-cache
  $(basename "$0") --no-build
EOF
}

NO_BUILD=false
NO_CACHE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build)
      NO_BUILD=true
      shift
      ;;
    --no-cache)
      NO_CACHE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      echo
      usage
      exit 1
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not in PATH."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: docker daemon is not running."
  exit 1
fi

if [[ ! -f "${COMPOSE_BASE}" || ! -f "${COMPOSE_DEV}" ]]; then
  echo "Error: compose files not found."
  echo "Expected:"
  echo "  ${COMPOSE_BASE}"
  echo "  ${COMPOSE_DEV}"
  exit 1
fi

COMPOSE_CMD=(docker compose --env-file "${ROOT_DIR}/release/.env.dev.example" -f "${COMPOSE_BASE}" -f "${COMPOSE_DEV}")

echo "=========================================="
echo "Refreshing Tenda service in dev stack"
echo "=========================================="
echo "Service: ${SERVICE_NAME}"
echo "Root:    ${ROOT_DIR}"
echo

if [[ "${NO_BUILD}" == false ]]; then
  echo "Step 1: Rebuilding ${SERVICE_NAME} image"
  if [[ "${NO_CACHE}" == true ]]; then
    docker build --no-cache -f "${TENDA_DIR}/Dockerfile.prod" -t abada-tenda:local "${TENDA_DIR}"
  else
    docker build -f "${TENDA_DIR}/Dockerfile.prod" -t abada-tenda:local "${TENDA_DIR}"
  fi
  echo
else
  echo "Step 1: Skipping image rebuild (--no-build)"
  echo
fi

echo "Step 2: Recreating ${SERVICE_NAME} container"
UP_ARGS=(up -d --force-recreate --no-deps)
if [[ "${NO_BUILD}" == true ]]; then
  UP_ARGS+=(--no-build)
fi
ABADA_TENDA_IMAGE=abada-tenda:local "${COMPOSE_CMD[@]}" "${UP_ARGS[@]}" "${SERVICE_NAME}"
echo

echo "Step 3: Service status"
"${COMPOSE_CMD[@]}" ps "${SERVICE_NAME}"
echo

echo "Refresh complete."
echo "Tenda URL: http://tenda.localhost"
