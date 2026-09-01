#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_command curl
require_command jq
project_id="$(<"$DEMO_DIR/.project-id")"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
AUTH_HEADER="$temporary/alice.header"
create_alice_auth_header "$AUTH_HEADER"
instance_id="$($DEMO_DIR/run-scenario.sh high)"

task_id=''
deadline=$((SECONDS + 120))
while (( SECONDS < deadline )); do
  tasks="$(curl --fail --silent --show-error -H @"$AUTH_HEADER" \
    "$API_URL/v1/projects/$project_id/tasks?status=AVAILABLE&page=0&size=100")"
  task_id="$(jq -r --arg instance "$instance_id" '.[] | select(.processInstanceId == $instance) | .id' <<<"$tasks" | head -1)"
  [[ -n "$task_id" ]] && break
  sleep 2
done
[[ -n "$task_id" ]] || { echo "Error: HIGH lead did not reach human review" >&2; exit 1; }

curl --fail --silent --show-error -o /dev/null -X POST \
  "$API_URL/v1/projects/$project_id/tasks/$task_id/claim" \
  -H @"$AUTH_HEADER" -H "Idempotency-Key: rehearse-claim-$task_id"
curl --fail --silent --show-error -o /dev/null -X POST \
  "$API_URL/v1/projects/$project_id/tasks/$task_id/complete" \
  -H @"$AUTH_HEADER" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: rehearse-complete-$task_id" \
  --data '{"reviewDecision":"approve","reviewNotes":"Qualified enterprise opportunity"}'
"$DEMO_DIR/demo-worker.sh" --drain

instance="$(curl --fail --silent --show-error -H @"$AUTH_HEADER" \
  "$API_URL/v1/projects/$project_id/instances/$instance_id")"
jq -e '.status == "COMPLETED" and .variables.triage.priority == "HIGH" and .variables.systemAck.adapter == "Local demo adapter"' \
  <<<"$instance" >/dev/null
echo "PASS HIGH instance $instance_id completed through human review and the local CRM adapter."
