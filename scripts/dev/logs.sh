#!/usr/bin/env bash
#
# Tail logs for one or more Compose services (dev stack).
#
# Usage:
#   ./scripts/dev/logs.sh              # all services
#   ./scripts/dev/logs.sh abada-engine # specific service
#   ./scripts/dev/logs.sh abada-engine abada-studio
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ABADA_ENV_FILE:-$ROOT_DIR/.env.dev}"

case "${1:-}" in
  -h|--help) sed -n '3,9p' "$0"; exit 0 ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/release/.env.dev.example" "$ENV_FILE"
fi

exec docker compose --env-file "$ENV_FILE" \
  -f "$ROOT_DIR/compose.yaml" \
  -f "$ROOT_DIR/compose.dev.yaml" \
  logs -f --tail=100 "${@:-.}"
