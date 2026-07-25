#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
docker build -f "$ROOT_DIR/engine/Dockerfile.prod.engine" -t abada-engine:local "$ROOT_DIR/engine"
docker build -f "$ROOT_DIR/tenda/Dockerfile.prod" -t abada-tenda:local "$ROOT_DIR/tenda"
docker build -f "$ROOT_DIR/orun/Dockerfile.prod" -t abada-orun:local "$ROOT_DIR/orun"
echo "Built abada-engine:local, abada-tenda:local and abada-orun:local."
