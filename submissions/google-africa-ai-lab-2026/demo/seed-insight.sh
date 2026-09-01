#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_command curl
require_command jq
[[ -f "$DEMO_DIR/.project-id" ]] || { echo "Error: run deploy-demo.sh first" >&2; exit 66; }
project_id="$(<"$DEMO_DIR/.project-id")"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
AUTH_HEADER="$temporary/alice.header"
create_alice_auth_header "$AUTH_HEADER"

instances=()
for sample in low-1 low-2 low-3 low-4; do
  instances+=("$($DEMO_DIR/run-scenario.sh "$sample")")
done
echo "Started four real LOW Gemini executions."

deadline=$((SECONDS + 180))
while (( SECONDS < deadline )); do
  "$DEMO_DIR/demo-worker.sh" --drain
  completed=0
  for instance_id in "${instances[@]}"; do
    status="$(curl --fail --silent --show-error -H @"$AUTH_HEADER" \
      "$API_URL/v1/projects/$project_id/instances/$instance_id" | jq -r '.status')"
    [[ "$status" == "COMPLETED" ]] && completed=$((completed + 1))
  done
  [[ "$completed" -eq 4 ]] && break
  sleep 3
done
[[ "$completed" -eq 4 ]] || { echo "Error: LOW executions did not all complete" >&2; exit 1; }

# Restart only the Engine after the facts exist. With the 24-hour interval and
# five-second initial delay this produces one controlled Insight cycle, avoiding
# the rc.4 multi-window query defect without altering product data.
compose_demo up -d --no-deps --force-recreate abada-engine >/dev/null
wait_for_engine
echo "Started the controlled Insight analysis cycle."

proposal=''
for attempt in 1 2 3; do
  proposal_deadline=$((SECONDS + 45))
  while (( SECONDS < proposal_deadline )); do
    page="$(curl --fail --silent --show-error -H @"$AUTH_HEADER" \
      "$API_URL/v1/projects/$project_id/insight/proposals?definitionKey=$PROCESS_KEY&page=0&size=20")"
    proposal_id="$(jq -r '.items[] | select(.status == "DRAFT" or .status == "IN_REVIEW") | .id' <<<"$page" | head -1)"
    if [[ -n "$proposal_id" ]]; then
      proposal="$(curl --fail --silent --show-error -H @"$AUTH_HEADER" \
        "$API_URL/v1/projects/$project_id/insight/proposals/$proposal_id")"
      if jq -e '.rationale | contains("suggested by LLM")' <<<"$proposal" >/dev/null \
        && jq -e '.proposedSource | contains("priority == '\''LOW'\''")' <<<"$proposal" >/dev/null; then
        jq -n --arg projectId "$project_id" --argjson proposal "$proposal" \
          '{projectId:$projectId,proposalId:$proposal.id,status:$proposal.status,rationale:$proposal.rationale}' \
          >"$DEMO_DIR/insight-proof.json"
        echo "Insight proposal #$proposal_id is a valid LLM suggestion with an explicit LOW rule."
        exit 0
      fi
    fi
    sleep 5
  done
  echo "Insight attempt $attempt did not yield a meaningful LLM diff yet."
done

echo "Error: no meaningful LLM-generated Insight proposal after three attempts" >&2
exit 1
