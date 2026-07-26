#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_FILE="$ROOT_DIR/deployment/telemetry/config.alloy"
ALLOY_IMAGE="grafana/alloy:v1.18.0"

command -v docker >/dev/null 2>&1 || {
  echo "Error: Docker is required to validate the Alloy configuration" >&2
  exit 69
}
[[ -f "$CONFIG_FILE" ]] || {
  echo "Error: Alloy configuration is missing: $CONFIG_FILE" >&2
  exit 66
}

docker run --rm \
  -v "$CONFIG_FILE:/etc/alloy/config.alloy:ro" \
  "$ALLOY_IMAGE" validate /etc/alloy/config.alloy

echo "Grafana Alloy configuration validation passed"
