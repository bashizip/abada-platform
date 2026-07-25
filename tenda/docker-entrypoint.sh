#!/bin/sh
set -eu

require_value() {
  name="$1"
  value="$2"
  if [ -z "$value" ]; then
    echo "Error: $name is required" >&2
    exit 64
  fi
  case "$value" in
    *"
"*) echo "Error: $name must be a single line" >&2; exit 64 ;;
  esac
}

escape_js() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

require_http_url() {
  name="$1"
  value="$2"
  case "$value" in
    http://*|https://*) ;;
    *) echo "Error: $name must be an HTTP(S) URL" >&2; exit 64 ;;
  esac
  authority="${value#*://}"
  authority="${authority%%/*}"
  case "$authority" in
    ""|*" "*|*"@"*|*"*"*) echo "Error: $name must contain a valid host" >&2; exit 64 ;;
  esac
}

require_value ABADA_API_URL "${ABADA_API_URL:-}"
require_value ABADA_OIDC_URL "${ABADA_OIDC_URL:-}"
require_value ABADA_OIDC_REALM "${ABADA_OIDC_REALM:-}"
require_value ABADA_OIDC_CLIENT_ID "${ABADA_OIDC_CLIENT_ID:-}"
require_http_url ABADA_API_URL "$ABADA_API_URL"
require_http_url ABADA_OIDC_URL "$ABADA_OIDC_URL"

config_path="${ABADA_CONFIG_PATH:-/usr/share/nginx/html/config.js}"
mkdir -p "$(dirname "$config_path")"
umask 022
{
  printf 'window.__ABADA_CONFIG__ = Object.freeze({\n'
  printf '  apiUrl: "%s",\n' "$(escape_js "$ABADA_API_URL")"
  printf '  oidcUrl: "%s",\n' "$(escape_js "$ABADA_OIDC_URL")"
  printf '  oidcRealm: "%s",\n' "$(escape_js "$ABADA_OIDC_REALM")"
  printf '  oidcClientId: "%s"\n' "$(escape_js "$ABADA_OIDC_CLIENT_ID")"
  printf '});\n'
} > "$config_path"

exec "$@"
