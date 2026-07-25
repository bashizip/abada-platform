#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
read -r -p "Delete the development containers and all Abada volumes? (y/N) " reply
[[ "$reply" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 1; }
ENV_FILE="${ABADA_ENV_FILE:-$ROOT_DIR/.env.dev}"
[[ -f "$ENV_FILE" ]] || cp "$ROOT_DIR/release/.env.dev.example" "$ENV_FILE"
exec docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml" down -v --remove-orphans
