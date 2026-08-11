#!/usr/bin/env bash
# Idempotently provision the first-party agent worker for the dev stack:
#   1. ensure the abada-agent-worker confidential client exists in Keycloak
#      with the engine audience + groups mappers and the .env.dev secret,
#   2. put its service-account user into the abada-worker group,
#   3. let the engine observe the service principal, then
#   4. bind the principal to the Default project's abada:agent topic.
#
# The engine runs in OIDC mode in dev, so a static ABADA_AGENT_ENGINE_TOKEN
# is not accepted; the worker authenticates with client credentials instead.
# Alice is the temporary global administrator and performs the binding.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ABADA_ENV_FILE:-$ROOT_DIR/.env.dev}"
CLIENT_ID="abada-agent-worker"
WORKER_USER="service-account-abada-agent-worker"
REALM="${ABADA_KEYCLOAK_REALM:-abada-dev}"
GROUP_NAME="abada-worker"
DEFAULT_PROJECT_ID="00000000-0000-0000-0000-000000000001"
TOPIC="abada:agent"
API_URL="${ABADA_PROVISION_API_URL:-http://api.localhost/api}"
OIDC_URL="${ABADA_PROVISION_OIDC_URL:-http://keycloak.localhost}"
KEYCLOAK_CONTAINER="${ABADA_KEYCLOAK_CONTAINER:-abada-keycloak-1}"
ADMIN_USER="${KEYCLOAK_ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
kcadm="/opt/keycloak/bin/kcadm.sh"

env_value() {
  awk -v key="$1" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

CLIENT_SECRET="$(env_value ABADA_AGENT_OIDC_CLIENT_SECRET)"
if [[ -z "$CLIENT_SECRET" ]]; then
  echo "Error: ABADA_AGENT_OIDC_CLIENT_SECRET is not set in $ENV_FILE" >&2
  exit 66
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Error: required command '$1' was not found" >&2; exit 69; }
}
require_command docker
require_command curl
require_command jq

docker info >/dev/null || { echo "Error: Docker is not running" >&2; exit 69; }

kc() { docker exec "$KEYCLOAK_CONTAINER" "$kcadm" "$@"; }

echo "Configuring Keycloak admin session..."
kc config credentials --server http://127.0.0.1:8080 --realm master \
  --user "$ADMIN_USER" --password "$ADMIN_PASSWORD" >/dev/null

# --- 1. Confidential client with engine audience + groups mappers -----------
CLIENT_ID_KC="$(kc get clients -r "$REALM" -q clientId="$CLIENT_ID" --fields id --format csv --noquotes 2>/dev/null || true)"
if [[ -z "$CLIENT_ID_KC" ]]; then
  echo "Creating confidential client $CLIENT_ID..."
  kc create clients -r "$REALM" \
    -s clientId="$CLIENT_ID" \
    -s enabled=true \
    -s publicClient=false \
    -s standardFlowEnabled=false \
    -s serviceAccountsEnabled=true \
    -s secret="$CLIENT_SECRET" >/dev/null
  CLIENT_ID_KC="$(kc get clients -r "$REALM" -q clientId="$CLIENT_ID" --fields id --format csv --noquotes)"
else
  echo "Updating client $CLIENT_ID secret and flags..."
  kc update "clients/$CLIENT_ID_KC" -r "$REALM" \
    -s enabled=true \
    -s publicClient=false \
    -s standardFlowEnabled=false \
    -s serviceAccountsEnabled=true \
    -s secret="$CLIENT_SECRET" >/dev/null
fi

# Remove any stale mapper set, then recreate the two required mappers.
MAPPER_IDS="$(kc get "clients/$CLIENT_ID_KC/protocol-mappers/models" -r "$REALM" --fields id --format csv --noquotes 2>/dev/null || true)"
for mapper_id in $MAPPER_IDS; do
  kc delete "clients/$CLIENT_ID_KC/protocol-mappers/models/$mapper_id" -r "$REALM" >/dev/null
done
echo "Adding engine audience and groups mappers..."
kc create "clients/$CLIENT_ID_KC/protocol-mappers/models" -r "$REALM" \
  -s name=abada-audience \
  -s protocol=openid-connect \
  -s protocolMapper=oidc-audience-mapper \
  -s 'config."included.client.audience"=abada-frontend' \
  -s 'config."access.token.claim"=true' \
  -s 'config."id.token.claim"=true' >/dev/null
kc create "clients/$CLIENT_ID_KC/protocol-mappers/models" -r "$REALM" \
  -s name=abada-groups \
  -s protocol=openid-connect \
  -s protocolMapper=oidc-group-membership-mapper \
  -s 'config."claim.name"=groups' \
  -s 'config."full.path"=false' \
  -s 'config."access.token.claim"=true' \
  -s 'config."id.token.claim"=true' \
  -s 'config."userinfo.token.claim"=true' >/dev/null

# --- 2. Service account in the abada-worker group ---------------------------
GROUP_ID="$(kc get groups -r "$REALM" -q search="$GROUP_NAME" --fields id,name --format csv --noquotes \
  | awk -F, -v name="$GROUP_NAME" '$2 == name { print $1; exit }')"
if [[ -z "$GROUP_ID" ]]; then
  kc create groups -r "$REALM" -s name="$GROUP_NAME" >/dev/null
  GROUP_ID="$(kc get groups -r "$REALM" -q search="$GROUP_NAME" --fields id,name --format csv --noquotes \
    | awk -F, -v name="$GROUP_NAME" '$2 == name { print $1; exit }')"
fi
WORKER_USER_ID="$(kc get users -r "$REALM" -q username="$WORKER_USER" --fields id,username --format csv --noquotes \
  | awk -F, -v user="$WORKER_USER" '$2 == user { print $1; exit }')"
if [[ -z "$WORKER_USER_ID" ]]; then
  echo "Error: service account user $WORKER_USER not found; is the client enabled?" >&2
  exit 1
fi
echo "Assigning $WORKER_USER to $GROUP_NAME..."
kc update "users/$WORKER_USER_ID/groups/$GROUP_ID" -r "$REALM" -n >/dev/null

# --- 3. Obtain tokens: worker client credentials + Alice (admin) ------------
client_credentials_token() {
  curl --fail --silent --show-error \
    -X POST "$OIDC_URL/realms/$REALM/protocol/openid-connect/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'client_id=abada-agent-worker' \
    --data-urlencode "client_secret=$CLIENT_SECRET" \
    --data-urlencode 'grant_type=client_credentials' \
    | jq -er '.access_token'
}

password_token() {
  local username="$1" password="$2"
  curl --fail --silent --show-error \
    -X POST "$OIDC_URL/realms/$REALM/protocol/openid-connect/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'client_id=abada-frontend' \
    --data-urlencode "username=$username" \
    --data-urlencode "password=$password" \
    --data-urlencode 'grant_type=password' \
    | jq -er '.access_token'
}

echo "Triggering engine principal observation for $WORKER_USER..."
WORKER_TOKEN="$(client_credentials_token)"
# The identity interceptor observes the service principal before the worker
# binding check runs, so even an unbound fetch (403) registers it. The running
# worker polls every second and also triggers this on its own. Any HTTP status
# is acceptable here; a missing principal is caught by the wait loop below.
curl --silent --show-error -o /dev/null \
  -X POST "$API_URL/v1/external-tasks/fetch-and-lock" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "{\"workerId\":\"abada-agent-worker\",\"topics\":[\"$TOPIC\"],\"lockDuration\":120000,\"maxTasks\":1,\"projectId\":\"$DEFAULT_PROJECT_ID\"}" \
  || true

echo "Authenticating Alice as the temporary global administrator..."
ALICE_TOKEN="$(password_token "alice" "alice")"

# --- 4. Bind the observed principal to the Default project's agent topic ----
PRINCIPAL_ID=""
for _ in $(seq 1 30); do
  PRINCIPAL_ID="$(curl --fail --silent --show-error \
    -H "Authorization: Bearer $ALICE_TOKEN" \
    "$API_URL/v1/projects/$DEFAULT_PROJECT_ID/principals?query=$WORKER_USER&size=50" \
    | jq -er --arg user "$WORKER_USER" '[.[] | select(.username == $user)][0].id // empty' 2>/dev/null || true)"
  [[ -n "$PRINCIPAL_ID" ]] && break
  sleep 2
done
if [[ -z "$PRINCIPAL_ID" ]]; then
  echo "Error: engine did not observe the $WORKER_USER principal within 60s" >&2
  echo "Is the stack up and the agent worker running? (./release/abada-platform up dev --agent)" >&2
  exit 1
fi

echo "Binding $WORKER_USER to project $DEFAULT_PROJECT_ID topic $TOPIC..."
curl --fail --silent --show-error \
  -X PUT \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "{\"topics\":[\"$TOPIC\"]}" \
  "$API_URL/v1/projects/$DEFAULT_PROJECT_ID/workers/$PRINCIPAL_ID" >/dev/null

echo "Agent worker provisioned: client=$CLIENT_ID group=$GROUP_NAME project=$DEFAULT_PROJECT_ID topic=$TOPIC"
