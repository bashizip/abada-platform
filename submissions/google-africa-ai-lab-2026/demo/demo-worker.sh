#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_command curl
require_command jq

CLIENT_ID="abada-demo-system-worker"
CLIENT_SECRET="$(env_value ABADA_DEMO_WORKER_OIDC_CLIENT_SECRET)"
[[ -n "$CLIENT_SECRET" ]] || { echo "Error: run provision-demo-worker.sh first" >&2; exit 78; }
WORKER_ID="abada-google-lab-local-adapter"
MODE="${1:---loop}"
empty_polls=0

access_token() {
  curl --fail --silent --show-error \
    -X POST "$OIDC_URL/realms/$REALM/protocol/openid-connect/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "client_id=$CLIENT_ID" \
    --data-urlencode "client_secret=$CLIENT_SECRET" \
    --data-urlencode 'grant_type=client_credentials' | jq -er '.access_token'
}

while true; do
  token="$(access_token)"
  tasks="$(curl --fail --silent --show-error \
    -X POST "$API_URL/v1/external-tasks/fetch-and-lock" \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "{\"workerId\":\"$WORKER_ID\",\"topics\":[\"demo.crm.upsert\",\"demo.nurture.enqueue\"],\"lockDuration\":60000,\"maxTasks\":10}")"
  count="$(jq 'length' <<<"$tasks")"
  if [[ "$count" -eq 0 ]]; then
    empty_polls=$((empty_polls + 1))
    if [[ "$MODE" == "--drain" && "$empty_polls" -ge 3 ]]; then exit 0; fi
    sleep 1
    continue
  fi
  empty_polls=0
  while IFS= read -r task; do
    task_id="$(jq -r '.id' <<<"$task")"
    topic="$(jq -r '.topicName' <<<"$task")"
    instance_id="$(jq -r '.processInstanceId' <<<"$task")"
    completion="$(jq -n --arg worker "$WORKER_ID" --arg topic "$topic" --arg instance "$instance_id" '{
      workerId: $worker,
      variables: {
        systemAck: {
          adapter: "Local demo adapter",
          topic: $topic,
          processInstanceId: $instance,
          status: "ACKNOWLEDGED"
        }
      }
    }')"
    curl --fail --silent --show-error -o /dev/null \
      -X POST "$API_URL/v1/external-tasks/$task_id/complete" \
      -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
      -H "Idempotency-Key: demo-complete-$task_id" --data "$completion"
    echo "Local demo adapter acknowledged $topic for instance $instance_id."
  done < <(jq -c '.[]' <<<"$tasks")
done
