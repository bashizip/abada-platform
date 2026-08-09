#!/usr/bin/env sh
# Idempotently grant the bundled development user Alice the temporary global
# Abada administrator group. Production identity providers are out of scope.

set -eu

container="${ABADA_KEYCLOAK_CONTAINER:-abada-keycloak-1}"
realm="${ABADA_KEYCLOAK_REALM:-abada-dev}"
admin_user="${KEYCLOAK_ADMIN_USERNAME:-admin}"
admin_password="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
kcadm="/opt/keycloak/bin/kcadm.sh"

docker exec "$container" "$kcadm" config credentials \
  --server http://127.0.0.1:8080 --realm master \
  --user "$admin_user" --password "$admin_password" >/dev/null

group_id="$(docker exec "$container" "$kcadm" get groups -r "$realm" \
  -q search=abada-admin --fields id,name --format csv --noquotes \
  | awk -F, '$2 == "abada-admin" { print $1; exit }')"

if [ -z "$group_id" ]; then
  docker exec "$container" "$kcadm" create groups -r "$realm" -s name=abada-admin >/dev/null
  group_id="$(docker exec "$container" "$kcadm" get groups -r "$realm" \
    -q search=abada-admin --fields id,name --format csv --noquotes \
    | awk -F, '$2 == "abada-admin" { print $1; exit }')"
fi

user_id="$(docker exec "$container" "$kcadm" get users -r "$realm" \
  -q username=alice --fields id,username --format csv --noquotes \
  | awk -F, '$2 == "alice" { print $1; exit }')"

if [ -z "$user_id" ] || [ -z "$group_id" ]; then
  echo "Could not resolve Alice or the abada-admin group in realm $realm" >&2
  exit 1
fi

docker exec "$container" "$kcadm" update "users/$user_id/groups/$group_id" \
  -r "$realm" -n >/dev/null

echo "Alice now belongs to abada-admin in $realm. Sign in again to refresh her token."
