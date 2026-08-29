#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

for command in docker jq; do
  command -v "$command" >/dev/null 2>&1 || { echo "Error: required command '$command' is unavailable" >&2; exit 69; }
done

grep -q 'docker/setup-qemu-action@v3' "$ROOT_DIR/.github/workflows/docker-publish-ghcr.yml"
grep -q 'platforms: linux/amd64,linux/arm64' "$ROOT_DIR/.github/workflows/docker-publish-ghcr.yml"
grep -q 'verify-image-platforms.sh' "$ROOT_DIR/.github/workflows/docker-publish-ghcr.yml"
test -x "$ROOT_DIR/scripts/test/verify-image-platforms.sh"
grep -q 'DOCKER_DEFAULT_PLATFORM.*linux/amd64' "$ROOT_DIR/release/abada-platform"
grep -q 'DOCKER_DEFAULT_PLATFORM.*linux/amd64' "$ROOT_DIR/release/abada-platform.ps1"
grep -q 'DOCKER_DEFAULT_PLATFORM.*linux/amd64' "$ROOT_DIR/release/quickstart.sh"
grep -q 'DOCKER_DEFAULT_PLATFORM.*linux/amd64' "$ROOT_DIR/release/quickstart.ps1"
for launcher in "$ROOT_DIR/release/abada-platform" "$ROOT_DIR/release/abada-platform.ps1"; do
  grep -q 'ABADA PLATFORM' "$launcher"
  grep -q 'alice / alice' "$launcher"
  grep -q 'Import and deploy' "$launcher"
done
grep -q 'bpmndi:BPMNDiagram' "$ROOT_DIR/release/samples/approval.bpmn"
# Studio is the sole supported operator UI. The retired Tenda/Orun apps and the
# orun-admin identity must not be reachable from any supported deployment path.
if jq -e '(.roles.realm | any(.name == "orun-admin")) or (.users | any(.username == "orun-admin")) or (.groups | any(.name == "orun-admin"))' \
  "$ROOT_DIR/docker/keycloak/import/realm-dev.json" >/dev/null; then
  echo "Retired orun-admin identity is still present in the development realm" >&2
  exit 1
fi
jq -e '
  (.users | any(
    .username == "alice"
    and (.groups | index("abada-admin") != null)
    and (.credentials | any(.type == "password" and .value == "alice" and .temporary == false))
  ))
' "$ROOT_DIR/docker/keycloak/import/realm-dev.json" >/dev/null
if jq -e '.clients[]? | select(.clientId == "abada-frontend") | (.redirectUris + .webOrigins) | any(test("5602|5603|tenda|orun"))' \
  "$ROOT_DIR/docker/keycloak/import/realm-dev.json" >/dev/null; then
  echo "Development realm still trusts retired Tenda/Orun frontend origins" >&2
  exit 1
fi

DEV=(docker compose --env-file "$ROOT_DIR/release/.env.dev.example" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml")
DEV_TELEMETRY=("${DEV[@]}" -f "$ROOT_DIR/compose.telemetry.yaml")
DEV_CANONICAL=(env -u GRAFANA_ADMIN_PASSWORD docker compose -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml")
DEV_TELEMETRY_CANONICAL=("${DEV_CANONICAL[@]}" -f "$ROOT_DIR/compose.telemetry.yaml")

assert_config_clean() {
  local output
  if ! output=$("$@" config --quiet 2>&1); then
    printf '%s\n' "$output" >&2
    return 1
  fi
  if [[ -n "$output" ]]; then
    echo "Compose configuration emitted warnings:" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi
}

assert_config_clean "${DEV[@]}"
assert_config_clean "${DEV_TELEMETRY[@]}"
assert_config_clean "${DEV_CANONICAL[@]}"
assert_config_clean "${DEV_TELEMETRY_CANONICAL[@]}"
DEV_EXTERNAL_FIXTURE=("${DEV[@]}" -f "$ROOT_DIR/deployment/tests/compose.external-otlp-test.yaml")
assert_config_clean "${DEV_EXTERNAL_FIXTURE[@]}"
"${DEV[@]}" config --format json >"$TMP_DIR/dev-config.json"
jq -e '.services.postgres.ports == null and .services["keycloak-db"].ports == null' "$TMP_DIR/dev-config.json" >/dev/null
jq -e '[.services[] | has("build")] | any | not' "$TMP_DIR/dev-config.json" >/dev/null
"${DEV[@]}" config --services > "$TMP_DIR/dev-services"
"${DEV_TELEMETRY[@]}" config --services > "$TMP_DIR/dev-telemetry-services"
# Studio is the sole supported operator UI; the retired Tenda/Orun services must
# not appear in any supported Compose profile, and Studio + Docs must be present.
if grep -Eq '^(abada-tenda|abada-orun)$' "$TMP_DIR/dev-services"; then
  echo "Retired Tenda/Orun service leaked into the development profile" >&2
  exit 1
fi
for service in abada-studio abada-docs; do
  grep -qx "$service" "$TMP_DIR/dev-services" || { echo "Missing supported service: $service" >&2; exit 1; }
done
if grep -Eq '^(otel-collector|grafana|prometheus|jaeger-volume-init|jaeger|loki|alloy|telemetry-health)$' "$TMP_DIR/dev-services"; then
  echo "Telemetry service leaked into the disabled development profile" >&2
  exit 1
fi
for service in otel-collector grafana prometheus jaeger-volume-init jaeger loki alloy telemetry-health; do
  grep -qx "$service" "$TMP_DIR/dev-telemetry-services" || { echo "Missing telemetry service: $service" >&2; exit 1; }
done

cp "$ROOT_DIR/release/.env.dev.example" "$TMP_DIR/dev-external.env"
sed -i.bak \
  -e 's|ABADA_TELEMETRY_ENABLED=false|ABADA_TELEMETRY_ENABLED=true|' \
  -e 's|ABADA_TELEMETRY_OTLP_ENDPOINT=|ABADA_TELEMETRY_OTLP_ENDPOINT=http://collector.abada.test:4318|' \
  -e 's|OTEL_SDK_DISABLED=true|OTEL_SDK_DISABLED=false|' \
  "$TMP_DIR/dev-external.env"
DEV_EXTERNAL=(docker compose --env-file "$TMP_DIR/dev-external.env" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml")
"${DEV_EXTERNAL[@]}" config >"$TMP_DIR/dev-external-config"
"${DEV_EXTERNAL[@]}" config --services >"$TMP_DIR/dev-external-services"
grep -q 'ABADA_TELEMETRY_ENABLED: "true"' "$TMP_DIR/dev-external-config"
grep -q 'ABADA_TELEMETRY_OTLP_ENDPOINT: http://collector.abada.test:4318' "$TMP_DIR/dev-external-config"
if grep -qx 'otel-collector' "$TMP_DIR/dev-external-services"; then
  echo "Development external OTLP mode unexpectedly includes the bundled collector" >&2
  exit 1
fi

cat > "$TMP_DIR/prod.env" <<'ENV'
ABADA_REGISTRY=ghcr.io/bashizip
ABADA_VERSION=1.0.0-rc.3-test
POSTGRES_PASSWORD=test-only-production-password
ABADA_API_HOST=api.abada.test
ABADA_STUDIO_HOST=studio.abada.test
ABADA_DOCS_HOST=docs.abada.test
ABADA_ACME_EMAIL=operations@abada.test
ABADA_ALLOWED_ORIGINS=https://studio.abada.test
OIDC_ISSUER_URI=https://identity.abada.test/realms/abada
OIDC_AUDIENCE=abada-api
OIDC_JWK_SET_URI=
ABADA_OIDC_URL=https://identity.abada.test
ABADA_OIDC_REALM=abada
ABADA_OIDC_CLIENT_ID=abada-frontend
GRAFANA_ADMIN_PASSWORD=test-only-grafana-password
GRAFANA_PORT=3000
ABADA_ENVIRONMENT=production
ABADA_TRACING_SAMPLING_PROBABILITY=0.1
ABADA_TELEMETRY_ENABLED=false
ABADA_TELEMETRY_OTLP_ENDPOINT=
OTEL_SDK_DISABLED=true
ENV

PROD=(docker compose --env-file "$TMP_DIR/prod.env" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.prod.yaml")
PROD_TELEMETRY=("${PROD[@]}" -f "$ROOT_DIR/compose.telemetry.yaml")
assert_config_clean "${PROD[@]}"
assert_config_clean "${PROD_TELEMETRY[@]}"
"${PROD[@]}" config > "$TMP_DIR/prod-config"
"${PROD[@]}" config --format json >"$TMP_DIR/prod-config.json"
grep -q 'ABADA_API_URL: https://api.abada.test/api' "$TMP_DIR/prod-config"
jq -e '.services.postgres.ports == null' "$TMP_DIR/prod-config.json" >/dev/null
jq -e '[.services[] | has("build")] | any | not' "$TMP_DIR/prod-config.json" >/dev/null
jq -e '(.services | has("abada-tenda") | not) and (.services | has("abada-orun") | not) and (.services | has("abada-studio")) and (.services | has("abada-docs"))' \
  "$TMP_DIR/prod-config.json" >/dev/null
jq -e '.services["abada-studio"].labels["traefik.http.services.studio-prod.loadbalancer.server.port"] == "5605"' \
  "$TMP_DIR/prod-config.json" >/dev/null

if env -i PATH="$PATH" docker compose -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.prod.yaml" config --quiet >"$TMP_DIR/missing.out" 2>&1; then
  echo "Production configuration unexpectedly accepted missing required values" >&2
  exit 1
fi

expect_preflight_failure() {
  local env_file="$1" expected="$2"
  if "$ROOT_DIR/release/abada-platform" doctor prod --env-file "$env_file" --no-pull >"$TMP_DIR/preflight.out" 2>&1; then
    echo "Production preflight unexpectedly accepted invalid configuration" >&2
    exit 1
  fi
  grep -q "$expected" "$TMP_DIR/preflight.out" || {
    echo "Production preflight failed for the wrong reason; expected: $expected" >&2
    cat "$TMP_DIR/preflight.out" >&2
    exit 1
  }
}

cp "$TMP_DIR/prod.env" "$TMP_DIR/invalid-host.env"
sed -i.bak 's|ABADA_API_HOST=api.abada.test|ABADA_API_HOST=https://api.abada.test/path|' "$TMP_DIR/invalid-host.env"
expect_preflight_failure "$TMP_DIR/invalid-host.env" 'ABADA_API_HOST must be a DNS hostname'

cp "$TMP_DIR/prod.env" "$TMP_DIR/invalid-oidc.env"
sed -i.bak 's|OIDC_ISSUER_URI=https://identity.abada.test|OIDC_ISSUER_URI=http://identity.abada.test|' "$TMP_DIR/invalid-oidc.env"
expect_preflight_failure "$TMP_DIR/invalid-oidc.env" 'OIDC_ISSUER_URI must be an HTTPS URL'

cp "$TMP_DIR/prod.env" "$TMP_DIR/invalid-cors.env"
sed -i.bak 's|ABADA_ALLOWED_ORIGINS=https://studio.abada.test|ABADA_ALLOWED_ORIGINS=*|' "$TMP_DIR/invalid-cors.env"
expect_preflight_failure "$TMP_DIR/invalid-cors.env" 'production CORS origin must be an exact HTTPS origin'

cp "$TMP_DIR/prod.env" "$TMP_DIR/missing-grafana-secret.env"
sed -i.bak 's|GRAFANA_ADMIN_PASSWORD=test-only-grafana-password|GRAFANA_ADMIN_PASSWORD=|' "$TMP_DIR/missing-grafana-secret.env"
if "$ROOT_DIR/release/abada-platform" doctor prod --telemetry --env-file "$TMP_DIR/missing-grafana-secret.env" --no-pull >"$TMP_DIR/preflight.out" 2>&1; then
  echo "Production telemetry preflight unexpectedly accepted a missing Grafana password" >&2
  exit 1
fi
grep -q 'telemetry requires a non-placeholder GRAFANA_ADMIN_PASSWORD' "$TMP_DIR/preflight.out"

cp "$TMP_DIR/prod.env" "$TMP_DIR/external.env"
sed -i.bak \
  -e 's|ABADA_TELEMETRY_ENABLED=false|ABADA_TELEMETRY_ENABLED=true|' \
  -e 's|ABADA_TELEMETRY_OTLP_ENDPOINT=|ABADA_TELEMETRY_OTLP_ENDPOINT=https://collector.abada.test:4318|' \
  -e 's|OTEL_SDK_DISABLED=true|OTEL_SDK_DISABLED=false|' \
  "$TMP_DIR/external.env"
EXTERNAL=(docker compose --env-file "$TMP_DIR/external.env" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.prod.yaml")
"${EXTERNAL[@]}" config > "$TMP_DIR/external-config"
"${EXTERNAL[@]}" config --services > "$TMP_DIR/external-services"
grep -q 'ABADA_TELEMETRY_ENABLED: "true"' "$TMP_DIR/external-config"
grep -q 'ABADA_TELEMETRY_OTLP_ENDPOINT: https://collector.abada.test:4318' "$TMP_DIR/external-config"
if grep -qx 'otel-collector' "$TMP_DIR/external-services"; then
  echo "External OTLP mode unexpectedly includes the bundled collector" >&2
  exit 1
fi

"${DEV_TELEMETRY[@]}" config --format json >"$TMP_DIR/telemetry-config.json"
jq -e '.services.grafana.ports | all(.host_ip == "127.0.0.1")' "$TMP_DIR/telemetry-config.json" >/dev/null
jq -e '[.services.alloy.volumes[]?.source] | index("/var/run/docker.sock") | not' \
  "$TMP_DIR/telemetry-config.json" >/dev/null
jq -e '.services.alloy.image == "grafana/alloy:v1.18.0"' \
  "$TMP_DIR/telemetry-config.json" >/dev/null
jq -e '.services.alloy.command | index("--disable-reporting") != null' \
  "$TMP_DIR/telemetry-config.json" >/dev/null
jq -e '.services["jaeger-volume-init"].image == "busybox:1.37.0"
  and .services["jaeger-volume-init"].user == "0:0"
  and .services["jaeger-volume-init"].network_mode == "none"
  and (.services["jaeger-volume-init"].command[2] | contains("chown -R 10001:10001 /badger"))
  and .services.jaeger.depends_on["jaeger-volume-init"].condition == "service_completed_successfully"' \
  "$TMP_DIR/telemetry-config.json" >/dev/null
jq -e '.services["telemetry-health"].healthcheck.test[1] | contains("otel-collector:13133") and contains("jaeger:16686") and contains("prometheus:9090/-/ready") and contains("loki:3100/ready") and contains("alloy:12345/-/ready") and contains("alloy:12345/-/healthy") and contains("grafana:3000/api/health")' \
  "$TMP_DIR/telemetry-config.json" >/dev/null
if grep -En '(^|:)latest([[:space:]]|$)' "$ROOT_DIR"/compose*.yaml >/dev/null; then
  echo "A supported Compose file uses the prohibited latest tag" >&2
  exit 1
fi

STUDIO_ENTRYPOINT="$ROOT_DIR/studio/docker-entrypoint.sh"
if ABADA_CONFIG_PATH="$TMP_DIR/config.js" "$STUDIO_ENTRYPOINT" true >"$TMP_DIR/entrypoint.out" 2>&1; then
  echo "Studio entrypoint accepted missing runtime configuration" >&2
  exit 1
fi
if ABADA_API_URL=not-a-url \
  ABADA_OIDC_URL=https://identity.abada.test \
  ABADA_OIDC_REALM=abada \
  ABADA_OIDC_CLIENT_ID=abada-frontend \
  ABADA_CONFIG_PATH="$TMP_DIR/config.js" \
  "$STUDIO_ENTRYPOINT" true >"$TMP_DIR/entrypoint.out" 2>&1; then
  echo "Studio entrypoint accepted malformed runtime configuration" >&2
  exit 1
fi
ABADA_API_URL=https://api.abada.test \
ABADA_OIDC_URL=https://identity.abada.test \
ABADA_OIDC_REALM=abada \
ABADA_OIDC_CLIENT_ID=abada-frontend \
ABADA_CONFIG_PATH="$TMP_DIR/config.js" \
"$STUDIO_ENTRYPOINT" true
grep -q 'https://api.abada.test' "$TMP_DIR/config.js"

"$ROOT_DIR/release/build-bundle.sh" 1.0.0-rc.3-test >/dev/null
grep -Eq '^[0-9a-fA-F]{64}  abada-platform-1\.0\.0-rc\.3-test\.tar\.gz$' \
  "$ROOT_DIR/release/dist/abada-platform-1.0.0-rc.3-test.tar.gz.sha256"
tar -xzf "$ROOT_DIR/release/dist/abada-platform-1.0.0-rc.3-test.tar.gz" --strip-components=1 -C "$TMP_DIR"
test -f "$TMP_DIR/deployment/telemetry/config.alloy"
test ! -e "$TMP_DIR/deployment/telemetry/promtail.yaml"
grep -q 'grafana/alloy:v1.18.0' "$TMP_DIR/compose.telemetry.yaml"
if grep -Eqi 'promtail' "$TMP_DIR/compose.telemetry.yaml"; then
  echo "The release archive still references the retired Promtail service" >&2
  exit 1
fi
if grep -Eq 'abada-tenda|abada-orun|ABADA_TENDA_IMAGE|ABADA_ORUN_IMAGE' \
  "$TMP_DIR/compose.yaml" "$TMP_DIR/compose.dev.yaml" "$TMP_DIR/compose.prod.yaml" "$TMP_DIR/release/.env.dev.example"; then
  echo "The release archive still references the retired Tenda/Orun services" >&2
  exit 1
fi
(
  cd "$ROOT_DIR/release/dist"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check abada-platform-1.0.0-rc.3-test.tar.gz.sha256
  else
    shasum -a 256 --check abada-platform-1.0.0-rc.3-test.tar.gz.sha256
  fi
)
if [[ "${ABADA_CONTRACT_SKIP_LIVE_PREFLIGHT:-false}" == "true" ]]; then
  docker compose --env-file "$TMP_DIR/release/.env.dev.example" \
    -f "$TMP_DIR/compose.yaml" -f "$TMP_DIR/compose.dev.yaml" config --quiet
  echo "Clean-directory live preflight skipped by ABADA_CONTRACT_SKIP_LIVE_PREFLIGHT"
else
  "$ROOT_DIR/scripts/test/validate-alloy-config.sh"
  "$TMP_DIR/release/abada-platform" doctor dev --env-file "$TMP_DIR/release/.env.dev.example" --no-pull
fi

echo "Platform deployment contract validation passed"
