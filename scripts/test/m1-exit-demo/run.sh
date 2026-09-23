#!/usr/bin/env bash
#
# M1 "truth and safety" exit demo (docs/development/roadmap.md).
#
# Runs against the dev stack started with ./scripts/dev/up.sh and checks the
# four exit criteria, exiting non-zero on the first one that fails:
#   1. a malicious expression is rejected at deploy;
#   2. invalid or low-confidence agent output routes to a human;
#   3. four slow agent tasks cause no duplicate model call (two rounds);
#   4. site claims match the code (claims checker).
#
# The overlay replaces the model with a scripted one that counts every call,
# runs two worker replicas with 6 s locks and makes slow calls take 30 s, so a
# lost lock would let the other replica call the model again.
#
# Side effect: the dev database's AI provider settings get a placeholder key
# (the engine refuses to start agent processes without one). Restore normal
# worker settings afterwards with ./scripts/dev/up.sh --no-build.
#
# Usage: ./scripts/test/m1-exit-demo/run.sh [--skip-setup]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEMO_DIR="$ROOT_DIR/scripts/test/m1-exit-demo"
ENV_FILE="${ABADA_ENV_FILE:-$ROOT_DIR/.env.dev}"
API_URL="${ABADA_DEMO_API_URL:-http://api.localhost/api}"
OIDC_URL="${ABADA_DEMO_OIDC_URL:-http://keycloak.localhost}"
RUN="${ABADA_DEMO_RUN_ID:-$(date +%Y%m%d%H%M%S)}"
SETUP=true
[[ "${1:-}" == "--skip-setup" ]] && SETUP=false

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
AUTH="$TMP_DIR/auth.header"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Error: required command '$1' is unavailable" >&2; exit 69; }
}
require_command curl
require_command docker
require_command jq
require_command node

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml"
  -f "$DEMO_DIR/compose.demo.yaml" --profile agent)
PSQL=(docker exec abada-postgres-1 psql -U abada -d abada_engine -At -c)

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

auth() {
  curl -fsS -X POST "$OIDC_URL/realms/abada-dev/protocol/openid-connect/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode client_id=abada-frontend \
    --data-urlencode username=alice --data-urlencode password=alice --data-urlencode grant_type=password \
    | jq -er '"Authorization: Bearer " + .access_token' >"$AUTH"
  chmod 600 "$AUTH"
}
get() { auth; curl -fsS -H @"$AUTH" "$API_URL$1"; }
start() { # mode caseId -> instance id
  auth
  curl -fsS -X POST -H @"$AUTH" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: m1demo-$RUN-$2" --data "{\"mode\":\"$1\",\"caseId\":\"$2\"}" \
    "$API_URL/v1/processes/start?processId=m1_demo_contract&username=alice" | jq -er .processInstanceId
}
model_calls() { # case prefix -> JSON array of {case, calls}
  docker exec abada-mock-llm-1 wget -qO- http://127.0.0.1:8000/calls \
    | jq -c --arg p "$1" '[.[] | select(.case | startswith($p))] | group_by(.case) | map({case: .[0].case, calls: length})'
}
wait_past_agent() { # instance ids...; the agent node is 'classify'
  local deadline=$((SECONDS + 180)) busy id
  while :; do
    busy=0
    for id in "$@"; do
      [[ "$(get "/v1/processes/instances/$id" | jq -r '.currentActivityId // ""')" == classify ]] && busy=1
    done
    [[ $busy == 0 ]] && return
    ((SECONDS < deadline)) || fail "agent tasks still running after 180 s"
    sleep 3
  done
}

if $SETUP; then
  echo "Starting the demo overlay (scripted model, two worker replicas, 6 s locks)..."
  "${COMPOSE[@]}" up -d --wait abada-engine mock-llm abada-agent-worker >"$TMP_DIR/compose.log" 2>&1 \
    || { cat "$TMP_DIR/compose.log" >&2; fail "could not start the demo overlay"; }
  auth
  curl -fsS -X PUT -H @"$AUTH" -H 'Content-Type: application/json' \
    --data '{"enabled":true,"baseUrl":"http://mock-llm:8000/v1","model":"gpt-5-mini","apiKey":"demo-not-a-secret"}' \
    "$API_URL/v1/insight/config/ai" | jq -e '.configured == true' >/dev/null || fail "could not set the placeholder AI key"
fi

auth
curl -fsS -H @"$AUTH" -H "Idempotency-Key: m1demo-$RUN-deploy" \
  -F "file=@$DEMO_DIR/processes/demo-contract.apl.yaml;filename=demo-contract.apl.yaml;type=application/yaml" \
  "$API_URL/v1/processes/deploy" | jq -e '.processDefinitionId == "m1_demo_contract"' >/dev/null \
  || fail "could not deploy the demo contract process"

echo "## 1. Malicious expressions are rejected at deploy"
for f in malicious-java malicious-js; do
  code=$(curl -sS -o "$TMP_DIR/$f.json" -w '%{http_code}' -H @"$AUTH" -H "Idempotency-Key: m1demo-$RUN-$f" \
    -F "file=@$DEMO_DIR/processes/$f.apl.yaml;filename=$f.apl.yaml;type=application/yaml" "$API_URL/v1/processes/deploy")
  [[ "$code" == 400 ]] || fail "$f deployed with HTTP $code"
  jq -e '.details.issues[0].elementId == "route"' "$TMP_DIR/$f.json" >/dev/null || fail "$f rejection does not name node 'route'"
  echo "  $f: HTTP 400 $(jq -c '{code, node: .details.issues[0].elementId}' "$TMP_DIR/$f.json")"
done
docker exec abada-abada-engine-1 sh -c 'test ! -e /tmp/pwned' || fail "/tmp/pwned exists in the engine container"
pass "both expressions rejected with the node id; nothing executed"

echo "## 2. Invalid or low-confidence output routes to a human"
ok=$(start OK "$RUN-route-OK"); invalid=$(start INVALID "$RUN-route-INVALID"); low=$(start LOW "$RUN-route-LOW")
wait_past_agent "$ok" "$invalid" "$low"
get "/v1/processes/instances/$ok" | jq -e '.status == "COMPLETED" and .variables.classify_outcome == "OK"' >/dev/null \
  || fail "valid output did not complete"
get "/v1/processes/instances/$invalid" | jq -e '.currentActivityId == "review" and .variables.classify_outcome == "INVALID_OUTPUT" and .variables.lead_priority == null' >/dev/null \
  || fail "invalid output did not route to review, or its value was written"
get "/v1/processes/instances/$low" | jq -e '.currentActivityId == "review" and .variables.classify_outcome == "LOW_CONFIDENCE"' >/dev/null \
  || fail "low-confidence output did not route to review"
model_calls "$RUN-route-" | jq -e 'length == 3 and all(.calls == 1)' >/dev/null || fail "expected one model call per routing case"
task=$(get "/v1/tasks?size=100" | jq -er --arg p "$invalid" '[.[] | select(.processInstanceId == $p)][0].id') \
  || fail "the review task is not visible to a reviewer"
auth
curl -fsS -X POST -H @"$AUTH" -H "Idempotency-Key: m1demo-$RUN-claim" "$API_URL/v1/tasks/claim?taskId=$task" >/dev/null
curl -fsS -X POST -H @"$AUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: m1demo-$RUN-complete" \
  --data '{"lead_priority":{"priority":"HIGH"}}' "$API_URL/v1/tasks/complete?taskId=$task" >/dev/null
get "/v1/processes/instances/$invalid" | jq -e '.status == "COMPLETED" and .variables.lead_priority.priority == "HIGH"' >/dev/null \
  || fail "the reviewer's decision did not complete the case"
pass "INVALID_OUTPUT and LOW_CONFIDENCE reached review; a reviewer completed the invalid case"

for round in 1 2; do
  echo "## 3. Round $round: four slow agent tasks, two workers, no duplicate model call"
  ids=()
  for n in 1 2 3 4; do ids+=("$(start SLOW "$RUN-r$round-slow-$n")"); done
  wait_past_agent "${ids[@]}"
  for id in "${ids[@]}"; do
    get "/v1/processes/instances/$id" | jq -e '.status == "COMPLETED" and .variables.classify_outcome == "OK"' >/dev/null \
      || fail "slow task in instance $id did not complete"
  done
  calls=$(model_calls "$RUN-r$round-slow-")
  echo "  model calls: $calls"
  jq -e 'length == 4 and all(.calls == 1)' <<<"$calls" >/dev/null || fail "duplicate or missing model call"
  in_list=$(printf "'%s'," "${ids[@]}")
  echo "  tasks per worker: $("${PSQL[@]}" "select string_agg(worker_id || '=' || n, ' ') from (select worker_id, count(*) n from external_tasks where process_instance_id in (${in_list%,}) group by 1) t")"
  pass "4/4 completed with exactly one model call each"
done

echo "## 4. Site claims match the code"
node "$ROOT_DIR/abada-site/packages/web/tools/check-claims.mjs" || fail "retracted claims found on the site"
pass "claims checker"

echo "M1 exit demo passed (run $RUN)"
