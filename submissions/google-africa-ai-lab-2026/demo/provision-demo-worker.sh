#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_command curl
require_command docker
require_command jq

CLIENT_ID="abada-demo-system-worker"
WORKER_USER="service-account-$CLIENT_ID"
GROUP_NAME="abada-worker"
ADMIN_USER="${KEYCLOAK_ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
KEY_NAME="ABADA_DEMO_WORKER_OIDC_CLIENT_SECRET"
SECRET="$(env_value "$KEY_NAME")"
if [[ -z "$SECRET" ]]; then
  SECRET="$(openssl rand -hex 32)"
  set_env_value "$KEY_NAME" "$SECRET"
  echo "Generated and stored the demo worker secret in .env.dev."
fi

container="$(compose_demo ps -q keycloak)"
[[ -n "$container" ]] || { echo "Error: Keycloak is not running" >&2; exit 69; }
kc=(docker exec "$container" /opt/keycloak/bin/kcadm.sh)
"${kc[@]}" config credentials --server http://127.0.0.1:8080 --realm master \
  --user "$ADMIN_USER" --password "$ADMIN_PASSWORD" >/dev/null

client_uuid="$("${kc[@]}" get clients -r "$REALM" -q clientId="$CLIENT_ID" --fields id --format csv --noquotes 2>/dev/null || true)"
if [[ -z "$client_uuid" ]]; then
  "${kc[@]}" create clients -r "$REALM" -s clientId="$CLIENT_ID" -s enabled=true \
    -s publicClient=false -s standardFlowEnabled=false -s serviceAccountsEnabled=true \
    -s secret="$SECRET" >/dev/null
  client_uuid="$("${kc[@]}" get clients -r "$REALM" -q clientId="$CLIENT_ID" --fields id --format csv --noquotes)"
else
  "${kc[@]}" update "clients/$client_uuid" -r "$REALM" -s enabled=true \
    -s publicClient=false -s standardFlowEnabled=false -s serviceAccountsEnabled=true \
    -s secret="$SECRET" >/dev/null
fi

mapper_ids="$("${kc[@]}" get "clients/$client_uuid/protocol-mappers/models" -r "$REALM" --fields id --format csv --noquotes 2>/dev/null || true)"
for mapper_id in $mapper_ids; do
  "${kc[@]}" delete "clients/$client_uuid/protocol-mappers/models/$mapper_id" -r "$REALM" >/dev/null
done
"${kc[@]}" create "clients/$client_uuid/protocol-mappers/models" -r "$REALM" \
  -s name=abada-audience -s protocol=openid-connect -s protocolMapper=oidc-audience-mapper \
  -s 'config."included.client.audience"=abada-frontend' \
  -s 'config."access.token.claim"=true' >/dev/null
"${kc[@]}" create "clients/$client_uuid/protocol-mappers/models" -r "$REALM" \
  -s name=abada-groups -s protocol=openid-connect -s protocolMapper=oidc-group-membership-mapper \
  -s 'config."claim.name"=groups' -s 'config."full.path"=false' \
  -s 'config."access.token.claim"=true' >/dev/null

group_id="$("${kc[@]}" get groups -r "$REALM" -q search="$GROUP_NAME" --fields id,name --format csv --noquotes \
  | awk -F, -v name="$GROUP_NAME" '$2 == name { print $1; exit }')"
user_id="$("${kc[@]}" get users -r "$REALM" -q username="$WORKER_USER" --fields id,username --format csv --noquotes \
  | awk -F, -v user="$WORKER_USER" '$2 == user { print $1; exit }')"
[[ -n "$group_id" && -n "$user_id" ]] || { echo "Error: worker group or service account is missing" >&2; exit 69; }
"${kc[@]}" update "users/$user_id/groups/$group_id" -r "$REALM" -n >/dev/null

token="$(curl --fail --silent --show-error \
  -X POST "$OIDC_URL/realms/$REALM/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_secret=$SECRET" \
  --data-urlencode 'grant_type=client_credentials' | jq -er '.access_token')"
curl --fail --silent --show-error -o /dev/null -X PUT "$API_URL/v1/workers/me" \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  --data '{"topics":["demo.crm.upsert","demo.nurture.enqueue"],"models":[]}'
echo "Local demo adapter provisioned for demo.crm.upsert and demo.nurture.enqueue."
