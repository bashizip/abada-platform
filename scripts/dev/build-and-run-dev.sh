#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
docker build -f "$ROOT_DIR/engine/Dockerfile.prod.engine" -t abada-engine:local "$ROOT_DIR/engine"
docker build -f "$ROOT_DIR/tenda/Dockerfile.prod" -t abada-tenda:local "$ROOT_DIR/tenda"
docker build -f "$ROOT_DIR/orun/Dockerfile.prod" -t abada-orun:local "$ROOT_DIR/orun"
export ABADA_ENGINE_IMAGE=abada-engine:local
export ABADA_TENDA_IMAGE=abada-tenda:local
export ABADA_ORUN_IMAGE=abada-orun:local
exec "$ROOT_DIR/release/abada-platform" up dev --no-pull "$@"
