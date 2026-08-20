#!/usr/bin/env bash
#
# Stop the dev stack and remove all Abada volumes (databases, logs).
#
# Usage:
#   ./scripts/dev/clean.sh    # ask before wiping
#   ./scripts/dev/clean.sh -y  # skip confirmation
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ABADA_ENV_FILE:-$ROOT_DIR/.env.dev}"
FORCE=false

case "${1:-}" in
  "") ;;
  -y|--yes) FORCE=true ;;
  -h|--help) sed -n '3,9p' "$0"; exit 0 ;;
  *) echo "Usage: $0 [-y|--yes]" >&2; exit 2 ;;
esac

if [[ "$FORCE" != true ]]; then
  read -r -p "Delete the development containers and all Abada volumes? (y/N) " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 1; }
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/release/.env.dev.example" "$ENV_FILE"
fi

exec docker compose --env-file "$ENV_FILE" \
  -f "$ROOT_DIR/compose.yaml" \
  -f "$ROOT_DIR/compose.dev.yaml" \
  down -v --remove-orphans
