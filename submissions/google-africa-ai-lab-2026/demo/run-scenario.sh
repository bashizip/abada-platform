#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_command curl
require_command jq

scenario="${1:-}"
case "$scenario" in
  high|medium|low-1|low-2|low-3|low-4) ;;
  *) echo "Usage: $0 {high|medium|low-1|low-2|low-3|low-4}" >&2; exit 64 ;;
esac
[[ -f "$DEMO_DIR/.project-id" ]] || { echo "Error: run deploy-demo.sh first" >&2; exit 66; }
project_id="$(<"$DEMO_DIR/.project-id")"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
AUTH_HEADER="$temporary/alice.header"
create_alice_auth_header "$AUTH_HEADER"

instance_id="$(curl --fail --silent --show-error \
  -X POST "$API_URL/v1/projects/$project_id/processes/$PROCESS_KEY/start" \
  -H @"$AUTH_HEADER" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: lab-$scenario-$(date +%s%N)" \
  --data @"$DEMO_DIR/samples/$scenario.json" | jq -er '.processInstanceId')"
echo "$instance_id"
