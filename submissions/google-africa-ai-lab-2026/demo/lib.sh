#!/usr/bin/env bash
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DEMO_DIR/../../.." && pwd)"
ENV_FILE="${ABADA_ENV_FILE:-$ROOT_DIR/.env.dev}"
API_URL="${ABADA_DEMO_API_URL:-http://api.localhost/api}"
OIDC_URL="${ABADA_DEMO_OIDC_URL:-http://keycloak.localhost}"
REALM="${ABADA_KEYCLOAK_REALM:-abada-dev}"
PROJECT_SLUG="google-ai-lab-demo"
PROCESS_KEY="google_lab_lead_triage"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Error: required command '$1' is unavailable" >&2
    exit 69
  }
}

env_value() {
  awk -v key="$1" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

set_env_value() {
  local key="$1" value="$2" temporary
  umask 077
  temporary="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    index($0, key "=") == 1 {
      if (!updated) print key "=" value
      updated = 1
      next
    }
    { print }
    END { if (!updated) print key "=" value }
  ' "$ENV_FILE" >"$temporary"
  mv "$temporary" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

wait_for_engine() {
  local attempt=0
  until curl --fail --silent "$API_URL/actuator/health/readiness" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [[ "$attempt" -ge 60 ]]; then
      echo "Error: Abada Engine did not become healthy within 120 seconds" >&2
      return 1
    fi
    sleep 2
  done
}

create_alice_auth_header() {
  local output_file="$1" token_file
  token_file="$(mktemp)"
  curl --fail --silent --show-error \
    -X POST "$OIDC_URL/realms/$REALM/protocol/openid-connect/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'client_id=abada-frontend' \
    --data-urlencode 'username=alice' \
    --data-urlencode 'password=alice' \
    --data-urlencode 'grant_type=password' >"$token_file"
  jq -e '.access_token | type == "string" and length > 0' "$token_file" >/dev/null
  printf 'Authorization: Bearer %s\n' "$(jq -r '.access_token' "$token_file")" >"$output_file"
  chmod 600 "$output_file"
  rm -f "$token_file"
}

compose_demo() {
  docker compose --project-name abada --env-file "$ENV_FILE" \
    -f "$ROOT_DIR/compose.yaml" \
    -f "$ROOT_DIR/compose.dev.yaml" \
    -f "$DEMO_DIR/compose.demo.yaml" \
    --profile agent "$@"
}
