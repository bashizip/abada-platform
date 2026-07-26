#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_URL="${ABADA_SMOKE_API_URL:-http://api.localhost/api}"
OIDC_URL="${ABADA_SMOKE_OIDC_URL:-http://keycloak.localhost}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Error: required command '$1' is unavailable" >&2; exit 69; }
}

require_command curl
require_command docker
require_command jq

COMPOSE=(docker compose --env-file "$ROOT_DIR/release/.env.dev.example" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml")

wait_for_health() {
  local attempts=0
  until curl --fail --silent --show-error "$API_URL/actuator/health/readiness" >"$TMP_DIR/health.json"; do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 60 ]]; then
      echo "Error: engine did not become healthy within 120 seconds" >&2
      return 1
    fi
    sleep 2
  done
  jq -e '.status == "UP"' "$TMP_DIR/health.json" >/dev/null
}

"${COMPOSE[@]}" config --services >"$TMP_DIR/services"
if grep -Eq '^(otel-collector|grafana|prometheus|jaeger-volume-init|jaeger|loki|alloy|telemetry-health)$' "$TMP_DIR/services"; then
  echo "Error: telemetry services are present in the telemetry-disabled profile" >&2
  exit 1
fi

wait_for_health

curl --fail --silent --show-error \
  -X POST "$OIDC_URL/realms/abada-dev/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'client_id=abada-frontend' \
  --data-urlencode 'username=alice' \
  --data-urlencode 'password=alice' \
  --data-urlencode 'grant_type=password' >"$TMP_DIR/token.json"
jq -e '.access_token | type == "string" and length > 0' "$TMP_DIR/token.json" >/dev/null
printf 'Authorization: Bearer %s\n' "$(jq -r '.access_token' "$TMP_DIR/token.json")" >"$TMP_DIR/auth.header"
chmod 600 "$TMP_DIR/auth.header"

curl --fail --silent --show-error \
  -H @"$TMP_DIR/auth.header" \
  -H "Idempotency-Key: platform-smoke-deploy-$(date +%s)" \
  -F "file=@$ROOT_DIR/release/samples/approval.bpmn;type=application/xml" \
  "$API_URL/v1/processes/deploy" >"$TMP_DIR/deployment.json"
jq -e '.processDefinitionId == "approval-quickstart" and (.version | type == "number")' "$TMP_DIR/deployment.json" >/dev/null

START_KEY="platform-smoke-start-$(date +%s)"
curl --fail --silent --show-error \
  -X POST \
  -H @"$TMP_DIR/auth.header" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $START_KEY" \
  --data '{"requestId":"platform-smoke"}' \
  "$API_URL/v1/processes/start?processId=approval-quickstart&username=alice" >"$TMP_DIR/start.json"
INSTANCE_ID="$(jq -er '.processInstanceId' "$TMP_DIR/start.json")"

curl --fail --silent --show-error \
  -H @"$TMP_DIR/auth.header" \
  "$API_URL/v1/tasks?status=AVAILABLE&size=100" >"$TMP_DIR/tasks-before-restart.json"
TASK_ID="$(jq -er --arg instance "$INSTANCE_ID" '[.[] | select(.processInstanceId == $instance)][0].id' "$TMP_DIR/tasks-before-restart.json")"

"${COMPOSE[@]}" restart abada-engine >/dev/null
wait_for_health

curl --fail --silent --show-error \
  -H @"$TMP_DIR/auth.header" \
  "$API_URL/v1/tasks/$TASK_ID" >"$TMP_DIR/task-after-restart.json"
jq -e --arg instance "$INSTANCE_ID" '.processInstanceId == $instance and .status == "AVAILABLE"' "$TMP_DIR/task-after-restart.json" >/dev/null

curl --fail --silent --show-error \
  -X POST \
  -H @"$TMP_DIR/auth.header" \
  -H "Idempotency-Key: platform-smoke-claim-$TASK_ID" \
  "$API_URL/v1/tasks/claim?taskId=$TASK_ID" >"$TMP_DIR/claim.json"
jq -e '.status == "Claimed"' "$TMP_DIR/claim.json" >/dev/null

curl --fail --silent --show-error \
  -X POST \
  -H @"$TMP_DIR/auth.header" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: platform-smoke-complete-$TASK_ID" \
  --data '{"approved":true}' \
  "$API_URL/v1/tasks/complete?taskId=$TASK_ID" >"$TMP_DIR/complete.json"
jq -e '.status == "Completed"' "$TMP_DIR/complete.json" >/dev/null

curl --fail --silent --show-error \
  -H @"$TMP_DIR/auth.header" \
  "$API_URL/v1/processes/instances/$INSTANCE_ID" >"$TMP_DIR/instance.json"
jq -e '.status == "COMPLETED" and .variables.approved == true' "$TMP_DIR/instance.json" >/dev/null

if "${COMPOSE[@]}" logs --no-color abada-engine | grep -Eqi 'failed to export|otel-collector|localhost:4318|connection.*4318'; then
  echo "Error: telemetry-disabled engine attempted telemetry export" >&2
  exit 1
fi

echo "Development platform smoke test passed: authenticated deploy, start, restart recovery, claim, and completion"
