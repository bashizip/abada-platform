#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_command curl
require_command jq
[[ -f "$DEMO_DIR/.project-id" && -f "$DEMO_DIR/insight-proof.json" ]] || {
  echo "Error: deploy and seed the demo first" >&2
  exit 66
}
project_id="$(<"$DEMO_DIR/.project-id")"
proposal_id="$(jq -er '.proposalId' "$DEMO_DIR/insight-proof.json")"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
AUTH_HEADER="$temporary/alice.header"
create_alice_auth_header "$AUTH_HEADER"

config="$(curl --fail --silent --show-error -H @"$AUTH_HEADER" "$API_URL/v1/insight/config/llm")"
proposal="$(curl --fail --silent --show-error -H @"$AUTH_HEADER" \
  "$API_URL/v1/projects/$project_id/insight/proposals/$proposal_id")"
instances="$(curl --fail --silent --show-error -H @"$AUTH_HEADER" \
  "$API_URL/v1/projects/$project_id/instances?processDefinitionId=$PROCESS_KEY&page=0&size=100")"

jq -e '.enabled and .configured and .model == "gemini-3.6-flash"' <<<"$config" >/dev/null
jq -e '.status == "DRAFT" or .status == "IN_REVIEW"' <<<"$proposal" >/dev/null
jq -e '.rationale | contains("FALLBACK_THRASH") and contains("suggested by LLM")' <<<"$proposal" >/dev/null
jq -e '.proposedSource | contains("priority == '\''LOW'\''")' <<<"$proposal" >/dev/null
low_count="$(jq '[.[] | select(.variables.triage.priority == "LOW" and .status == "COMPLETED")] | length' <<<"$instances")"
[[ "$low_count" -ge 4 ]] || { echo "Error: expected at least four completed LOW instances" >&2; exit 1; }

echo "PASS Gemini 3.6 Flash configured"
echo "PASS $low_count completed LOW executions"
echo "PASS Insight proposal #$proposal_id is LLM-generated and remains unapproved"
echo "PASS explicit LOW rule is visible in the proposed source"
