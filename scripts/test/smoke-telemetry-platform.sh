#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ABADA_SMOKE_ENV_FILE:-$ROOT_DIR/release/.env.dev.example}"
API_URL="${ABADA_SMOKE_API_URL:-http://api.localhost/api}"
OIDC_URL="${ABADA_SMOKE_OIDC_URL:-http://keycloak.localhost}"
TMP_DIR="$(mktemp -d)"
COLLECTOR_STOPPED=false
ALLOY_STOPPED=false
LOKI_STOPPED=false
trap 'if [[ "$COLLECTOR_STOPPED" == "true" ]]; then "${COMPOSE[@]}" start otel-collector >/dev/null 2>&1 || true; fi; if [[ "$ALLOY_STOPPED" == "true" ]]; then "${COMPOSE[@]}" start alloy >/dev/null 2>&1 || true; fi; if [[ "$LOKI_STOPPED" == "true" ]]; then "${COMPOSE[@]}" start loki >/dev/null 2>&1 || true; fi; rm -rf "$TMP_DIR"' EXIT

for command in curl docker jq; do
  command -v "$command" >/dev/null 2>&1 || { echo "Error: required command '$command' is unavailable" >&2; exit 69; }
done

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml" -f "$ROOT_DIR/compose.telemetry.yaml")
GRAFANA_PASSWORD="$(sed -n 's/^GRAFANA_ADMIN_PASSWORD=//p' "$ENV_FILE" | tail -n 1)"
[[ -n "$GRAFANA_PASSWORD" ]] || { echo "Error: GRAFANA_ADMIN_PASSWORD is required" >&2; exit 64; }

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
  -H "Idempotency-Key: telemetry-smoke-deploy-$(date +%s)" \
  -F "file=@$ROOT_DIR/release/samples/approval.bpmn;type=application/xml" \
  "$API_URL/v1/processes/deploy" >"$TMP_DIR/deployment.json"
curl --fail --silent --show-error \
  -X POST \
  -H @"$TMP_DIR/auth.header" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: telemetry-smoke-start-$(date +%s)" \
  --data '{"source":"telemetry-smoke"}' \
  "$API_URL/v1/processes/start?processId=approval-quickstart&username=alice" >"$TMP_DIR/start.json"
jq -e '.processInstanceId | type == "string" and length > 0' "$TMP_DIR/start.json" >/dev/null

for attempt in $(seq 1 24); do
  "${COMPOSE[@]}" exec -T telemetry-health \
    curl --fail --silent --show-error -u "admin:$GRAFANA_PASSWORD" \
    --get --data-urlencode 'query=abada_process_instances_started_total' \
    'http://grafana:3000/api/datasources/proxy/uid/prometheus/api/v1/query' >"$TMP_DIR/metrics.json" || true
  "${COMPOSE[@]}" exec -T telemetry-health \
    curl --fail --silent --show-error -u "admin:$GRAFANA_PASSWORD" \
    'http://grafana:3000/api/datasources/proxy/uid/jaeger/api/services' >"$TMP_DIR/traces.json" || true
  "${COMPOSE[@]}" exec -T telemetry-health \
    curl --fail --silent --show-error -u "admin:$GRAFANA_PASSWORD" \
    --get --data-urlencode 'query={service_name="abada-engine"} | json | traceId != ""' \
    --data-urlencode "start=$(($(date +%s) - 300))000000000" \
    --data-urlencode "end=$(date +%s)000000000" \
    --data-urlencode 'limit=20' \
    'http://grafana:3000/api/datasources/proxy/uid/loki/loki/api/v1/query_range' >"$TMP_DIR/logs.json" || true

  if jq -e '.data.result[]? | select((.value[1] | tonumber) > 0)' "$TMP_DIR/metrics.json" >/dev/null 2>&1 \
    && jq -e '.data[]? | select(. == "abada-engine")' "$TMP_DIR/traces.json" >/dev/null 2>&1 \
    && jq -e '.data.result | length > 0' "$TMP_DIR/logs.json" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 24 ]]; then
    echo "Error: correlated metrics, traces, and logs did not arrive within two minutes" >&2
    exit 1
  fi
  sleep 5
done

"${COMPOSE[@]}" stop otel-collector >/dev/null
COLLECTOR_STOPPED=true

curl --fail --silent --show-error \
  -X POST \
  -H @"$TMP_DIR/auth.header" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: telemetry-outage-start-$(date +%s)" \
  --data '{"source":"collector-outage"}' \
  "$API_URL/v1/processes/start?processId=approval-quickstart&username=alice" >"$TMP_DIR/outage-start.json"
jq -e '.processInstanceId | type == "string" and length > 0' "$TMP_DIR/outage-start.json" >/dev/null
curl --fail --silent --show-error "$API_URL/actuator/health/readiness" >"$TMP_DIR/outage-health.json"
jq -e '.status == "UP"' "$TMP_DIR/outage-health.json" >/dev/null

"${COMPOSE[@]}" start otel-collector >/dev/null
COLLECTOR_STOPPED=false

"${COMPOSE[@]}" stop alloy >/dev/null
ALLOY_STOPPED=true
curl --fail --silent --show-error \
  -X POST \
  -H @"$TMP_DIR/auth.header" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: alloy-outage-start-$(date +%s)" \
  --data '{"source":"alloy-outage"}' \
  "$API_URL/v1/processes/start?processId=approval-quickstart&username=alice" >"$TMP_DIR/alloy-outage-start.json"
jq -e '.processInstanceId | type == "string" and length > 0' "$TMP_DIR/alloy-outage-start.json" >/dev/null
curl --fail --silent --show-error "$API_URL/actuator/health/readiness" | jq -e '.status == "UP"' >/dev/null
"${COMPOSE[@]}" start alloy >/dev/null
ALLOY_STOPPED=false

"${COMPOSE[@]}" stop loki >/dev/null
LOKI_STOPPED=true
curl --fail --silent --show-error \
  -X POST \
  -H @"$TMP_DIR/auth.header" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: loki-outage-start-$(date +%s)" \
  --data '{"source":"loki-outage"}' \
  "$API_URL/v1/processes/start?processId=approval-quickstart&username=alice" >"$TMP_DIR/loki-outage-start.json"
jq -e '.processInstanceId | type == "string" and length > 0' "$TMP_DIR/loki-outage-start.json" >/dev/null
curl --fail --silent --show-error "$API_URL/actuator/health/readiness" | jq -e '.status == "UP"' >/dev/null
"${COMPOSE[@]}" start loki >/dev/null
LOKI_STOPPED=false

"${COMPOSE[@]}" up -d --wait

if "${COMPOSE[@]}" logs --no-color alloy | grep -Eqi 'stats\.grafana\.org|alloy-usage-report'; then
  echo "Error: Alloy attempted anonymous usage reporting" >&2
  exit 1
fi

echo "Bundled telemetry smoke test passed: correlated signals arrived and Collector, Alloy, and Loki failures did not block workflow commands"
