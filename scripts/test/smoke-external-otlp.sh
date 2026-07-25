#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_URL="${ABADA_SMOKE_API_URL:-http://api.localhost/api}"
OIDC_URL="${ABADA_SMOKE_OIDC_URL:-http://keycloak.localhost}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

for command in curl docker jq; do
  command -v "$command" >/dev/null 2>&1 || { echo "Error: required command '$command' is unavailable" >&2; exit 69; }
done

COMPOSE=(docker compose --env-file "$ROOT_DIR/release/.env.dev.example" \
  -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml" \
  -f "$ROOT_DIR/deployment/tests/compose.external-otlp-test.yaml")

"${COMPOSE[@]}" config --services >"$TMP_DIR/services"
grep -qx 'otel-test-collector' "$TMP_DIR/services"
if grep -Eq '^(otel-collector|grafana|prometheus|jaeger|loki|alloy|telemetry-health)$' "$TMP_DIR/services"; then
  echo "Error: bundled telemetry service present in external OTLP test" >&2
  exit 1
fi

"${COMPOSE[@]}" up -d --wait

curl --fail --silent --show-error \
  -X POST "$OIDC_URL/realms/abada-dev/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'client_id=abada-frontend' \
  --data-urlencode 'username=alice' \
  --data-urlencode 'password=alice' \
  --data-urlencode 'grant_type=password' >"$TMP_DIR/token.json"
printf 'Authorization: Bearer %s\n' "$(jq -er '.access_token' "$TMP_DIR/token.json")" >"$TMP_DIR/auth.header"
chmod 600 "$TMP_DIR/auth.header"

curl --fail --silent --show-error \
  -H @"$TMP_DIR/auth.header" \
  -H "Idempotency-Key: external-otel-deploy-$(date +%s)" \
  -F "file=@$ROOT_DIR/release/samples/approval.bpmn;type=application/xml" \
  "$API_URL/v1/processes/deploy" >"$TMP_DIR/deployment.json"
curl --fail --silent --show-error \
  -X POST \
  -H @"$TMP_DIR/auth.header" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: external-otel-start-$(date +%s)" \
  --data '{"source":"external-otlp-smoke"}' \
  "$API_URL/v1/processes/start?processId=approval-quickstart&username=alice" >"$TMP_DIR/start.json"
jq -e '.processInstanceId | type == "string" and length > 0' "$TMP_DIR/start.json" >/dev/null

for attempt in $(seq 1 30); do
  "${COMPOSE[@]}" logs --no-color otel-test-collector >"$TMP_DIR/collector.log"
  if grep -q 'Traces' "$TMP_DIR/collector.log" && grep -q 'Metrics' "$TMP_DIR/collector.log"; then
    echo "External OTLP smoke test passed without the bundled telemetry stack"
    exit 0
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "Error: test collector did not receive both traces and metrics within 60 seconds" >&2
    exit 1
  fi
  sleep 2
done
