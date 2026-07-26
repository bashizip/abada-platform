#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "The canonical authentication test is the development platform smoke workflow."
exec "$ROOT_DIR/scripts/test/smoke-dev-platform.sh"
