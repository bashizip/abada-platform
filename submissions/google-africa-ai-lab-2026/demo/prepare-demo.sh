#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_command curl
require_command docker
require_command jq

[[ -f "$ENV_FILE" ]] || { echo "Error: missing $ENV_FILE" >&2; exit 66; }
GEMINI_KEY="$(env_value ABADA_AGENT_LLM_API_KEY)"
[[ -n "$GEMINI_KEY" ]] || {
  echo "Error: ABADA_AGENT_LLM_API_KEY is not set in .env.dev" >&2
  exit 78
}

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

echo "Checking Gemini 3.6 Flash with a minimal completion..."
set +e
gemini_status="$(curl --silent --show-error \
  -X POST 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' \
  -H "Authorization: Bearer $GEMINI_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"model":"gemini-3.6-flash","messages":[{"role":"user","content":"Reply with exactly READY"}],"temperature":0,"max_tokens":2048}' \
  --output "$temporary/gemini.json" --write-out '%{http_code}')"
curl_status=$?
set -e
if [[ "$curl_status" -ne 0 ]]; then
  echo "Error: Gemini network request failed with curl status $curl_status" >&2
  exit 1
fi
if [[ "$gemini_status" != 2* ]]; then
  message="$(jq -r '.error.message // "No provider error message"' "$temporary/gemini.json" 2>/dev/null || true)"
  echo "Error: Gemini endpoint returned HTTP $gemini_status: $message" >&2
  exit 1
fi
if ! jq -e '.choices[0].message.content | type == "string" and length > 0' "$temporary/gemini.json" >/dev/null; then
  finish_reason="$(jq -r '.choices[0].finish_reason // "unknown"' "$temporary/gemini.json")"
  echo "Error: Gemini returned no assistant text (finish reason: $finish_reason)" >&2
  exit 1
fi
echo "Gemini API key: SET; model response: OK"

docker info >/dev/null
postgres_id="$(compose_demo ps -q postgres)"
keycloak_id="$(compose_demo ps -q keycloak)"
[[ -n "$postgres_id" && -n "$keycloak_id" ]] || {
  echo "Error: the existing local Postgres and Keycloak services must be running" >&2
  exit 69
}
if [[ "$(docker exec "$postgres_id" psql -U abada -d postgres -tAc \
    "select 1 from pg_database where datname='abada_google_lab_demo_20260831'")" != "1" ]]; then
  docker exec "$postgres_id" createdb -U abada abada_google_lab_demo_20260831
  echo "Created the isolated abada_google_lab_demo_20260831 database."
fi

echo "Recreating Engine with the isolated demo database..."
compose_demo stop abada-agent-worker >/dev/null 2>&1 || true
compose_demo up -d --no-deps --force-recreate abada-engine
wait_for_engine

echo "Synchronizing the first-party Agent Worker identity..."
ABADA_ENV_FILE="$ENV_FILE" ABADA_KEYCLOAK_CONTAINER="$keycloak_id" \
  ABADA_PROVISION_API_URL="$API_URL" ABADA_PROVISION_OIDC_URL="$OIDC_URL" \
  "$ROOT_DIR/scripts/dev/provision-agent-worker.sh" >/dev/null
compose_demo up -d --no-deps --force-recreate abada-agent-worker

AUTH_HEADER="$temporary/alice.header"
create_alice_auth_header "$AUTH_HEADER"
curl --fail --silent --show-error -H @"$AUTH_HEADER" \
  "$API_URL/v1/insight/config/llm" >"$temporary/insight-config.json"
jq -e '.enabled == true and .configured == true and .model == "gemini-3.6-flash" and .openRouterEnabled == false' \
  "$temporary/insight-config.json" >/dev/null

worker_id="$(compose_demo ps -q abada-agent-worker)"
[[ -n "$worker_id" ]] || { echo "Error: agent worker container is missing" >&2; exit 69; }
[[ "$(docker inspect -f '{{.State.Status}}' "$worker_id")" == "running" ]] || {
  echo "Error: agent worker is not running" >&2
  exit 69
}

echo "Insight Engine: ENABLED; LLM: READY; model: gemini-3.6-flash"
echo "Agent Worker: RUNNING; Gemini key: SET"
