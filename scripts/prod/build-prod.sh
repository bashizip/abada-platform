#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
docker build -f "$ROOT_DIR/engine/Dockerfile.prod.engine" -t abada-engine:local "$ROOT_DIR/engine"
docker build -f "$ROOT_DIR/studio/Dockerfile.prod" -t abada-studio:local "$ROOT_DIR"
docker build -f "$ROOT_DIR/documentation/Dockerfile.prod" -t abada-docs:local "$ROOT_DIR/documentation"
docker build -f "$ROOT_DIR/agent-worker/Dockerfile" -t abada-agent-worker:local "$ROOT_DIR"
echo "Built abada-engine:local, abada-studio:local, abada-docs:local and abada-agent-worker:local."
