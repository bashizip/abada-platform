#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/abada-agent-start-test.XXXXXX")"
cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    echo "Automatic dev agent startup contract failed" >&2
    [[ -f "$TMP_DIR/default.out" ]] && cat "$TMP_DIR/default.out" >&2
    [[ -f "$TMP_DIR/no-agent.out" ]] && cat "$TMP_DIR/no-agent.out" >&2
    [[ -f "$TMP_DIR/docker.log" ]] && cat "$TMP_DIR/docker.log" >&2
  fi
  rm -rf "$TMP_DIR"
  exit "$status"
}
trap cleanup EXIT

FAKE_BIN="$TMP_DIR/bin"
DOCKER_LOG="$TMP_DIR/docker.log"
ENV_FILE="$TMP_DIR/dev.env"
mkdir -p "$FAKE_BIN"
cp "$ROOT_DIR/release/.env.dev.example" "$ENV_FILE"

cat >"$FAKE_BIN/docker" <<'FIXTURE'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  info)
    if [[ "$*" == *"--format"* ]]; then
      printf '%s\n' amd64
    fi
    ;;
  volume)
    exit 0
    ;;
  compose)
    printf '%s\n' "$*" >>"${ABADA_TEST_DOCKER_LOG:?}"
    if [[ "$*" == *" ps -q keycloak"* ]]; then
      printf '%s\n' test-keycloak-container
    fi
    ;;
  exec)
    case "$*" in
      *" get clients "*) printf '%s\n' test-client-id ;;
      *" get groups "*) printf '%s\n' 'test-group-id,abada-worker' ;;
      *" get users "*) printf '%s\n' 'test-user-id,service-account-abada-agent-worker' ;;
    esac
    ;;
  *)
    exit 1
    ;;
esac
FIXTURE

cat >"$FAKE_BIN/curl" <<'FIXTURE'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$*" == *"/protocol/openid-connect/token"* ]]; then
  printf '%s\n' '{"access_token":"test-worker-token"}'
elif [[ "$*" == *" -X PUT "* ]]; then
  exit 0
else
  printf '%s\n' '{"capabilities":[{"topic":"abada:agent","models":[]}]}'
fi
FIXTURE

cat >"$FAKE_BIN/lsof" <<'FIXTURE'
#!/usr/bin/env bash
exit 1
FIXTURE

chmod +x "$FAKE_BIN/docker" "$FAKE_BIN/curl" "$FAKE_BIN/lsof"

ABADA_TEST_DOCKER_LOG="$DOCKER_LOG" PATH="$FAKE_BIN:$PATH" \
  "$ROOT_DIR/release/abada-platform" up dev --env-file "$ENV_FILE" --no-pull \
  >"$TMP_DIR/default.out"

grep -q 'Provisioning the first-party agent worker' "$TMP_DIR/default.out"
grep -Eq -- '--profile agent up -d --wait abada-agent-worker$' "$DOCKER_LOG"
SECRET="$(awk -F= '$1 == "ABADA_AGENT_OIDC_CLIENT_SECRET" { print $2; exit }' "$ENV_FILE")"
[[ "$SECRET" =~ ^[0-9a-f]{64}$ ]]

: >"$DOCKER_LOG"
ABADA_TEST_DOCKER_LOG="$DOCKER_LOG" PATH="$FAKE_BIN:$PATH" \
  "$ROOT_DIR/release/abada-platform" up dev --no-agent --env-file "$ENV_FILE" --no-pull \
  >"$TMP_DIR/no-agent.out"

if grep -q 'Provisioning the first-party agent worker' "$TMP_DIR/no-agent.out" || \
   grep -q -- '--profile agent' "$DOCKER_LOG"; then
  echo "The explicit --no-agent path unexpectedly activated the worker" >&2
  exit 1
fi

: >"$DOCKER_LOG"
ABADA_TEST_DOCKER_LOG="$DOCKER_LOG" ABADA_ENV_FILE="$ENV_FILE" PATH="$FAKE_BIN:$PATH" \
  "$ROOT_DIR/scripts/dev/up.sh" --no-build >"$TMP_DIR/source-up.out"

grep -q 'Agent worker is ready' "$TMP_DIR/source-up.out"
grep -Eq -- '--profile agent up -d --wait abada-agent-worker$' "$DOCKER_LOG"

echo "Automatic dev agent startup contract passed"
