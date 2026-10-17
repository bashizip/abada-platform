#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/abada-install-test.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

VERSION="9.8.7-test.1"
ARCHIVE="abada-platform-${VERSION}.tar.gz"
PUBLIC_DIR="$TMP_DIR/public"
STAGING_DIR="$TMP_DIR/staging/abada-platform-${VERSION}"
FAKE_BIN="$TMP_DIR/bin"
MARKER="$TMP_DIR/platform-invocation"
INSTALL_OUTPUT="$TMP_DIR/install-output"
REAL_CURL="$(command -v curl)"

mkdir -p "$PUBLIC_DIR" "$STAGING_DIR/release" "$FAKE_BIN"
printf '%s\n' "$VERSION" >"$PUBLIC_DIR/latest"
printf '%s\n' "ABADA_ENGINE_IMAGE=ghcr.io/bashizip/abada-engine:${VERSION}" \
  "ABADA_STUDIO_IMAGE=ghcr.io/bashizip/abada-studio:${VERSION}" \
  'POSTGRES_PASSWORD=abada' 'ABADA_NEW_SETTING=default-value' \
  'ABADA_LLM_GEMINI_API_KEY=' \
  'ABADA_LLM_API_KEY=' 'ABADA_LLM_BASE_URL=' 'ABADA_LLM_MODEL=gemini-3.6-flash' \
  'ABADA_INSIGHT_ENABLED=false' 'ABADA_INSIGHT_LLM_TIMEOUT_MS=90000' \
  'ABADA_STARTER_WORKFLOW_ENABLED=true' \
  >"$STAGING_DIR/release/.env.dev.example"

cat >"$STAGING_DIR/release/abada-platform" <<'FIXTURE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >"${ABADA_TEST_MARKER:?}"
# Like `docker compose exec`, read stdin when asked to: under `curl | bash` that
# stdin is the rest of the installer itself.
[[ -z "${ABADA_TEST_READ_STDIN:-}" ]] || cat >/dev/null
FIXTURE
chmod +x "$STAGING_DIR/release/abada-platform"

tar -C "$TMP_DIR/staging" -czf "$PUBLIC_DIR/$ARCHIVE" "abada-platform-${VERSION}"
(
  cd "$PUBLIC_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$ARCHIVE" >"$ARCHIVE.sha256"
  else
    shasum -a 256 "$ARCHIVE" >"$ARCHIVE.sha256"
  fi
)

cat >"$FAKE_BIN/docker" <<'FIXTURE'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  info|compose) exit 0 ;;
  *) exit 1 ;;
esac
FIXTURE
chmod +x "$FAKE_BIN/docker"

cat >"$FAKE_BIN/curl" <<'FIXTURE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"generativelanguage.googleapis.com"* ]]; then
  output=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--output" ]]; then output="$2"; shift 2; continue; fi
    shift
  done
  printf '%s\n' '{"choices":[{"message":{"content":"READY"}}]}' >"$output"
  printf '200'
  exit 0
fi
if [[ "$*" == *"/v1/install-event"* ]]; then
  # The anonymous install report: keep what would have been sent, optionally fail like an unreachable host.
  data=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--data" ]]; then data="$2"; shift 2; continue; fi
    shift
  done
  printf '%s\n' "$data" >>"${ABADA_TEST_EVENTS:?}"
  [[ -z "${ABADA_TEST_PING_FAIL:-}" ]] || exit 22
  exit 0
fi
exec "${ABADA_TEST_REAL_CURL:?}" "$@"
FIXTURE
chmod +x "$FAKE_BIN/curl"

cmp "$ROOT_DIR/install/install.sh" "$ROOT_DIR/install/public/install.sh" || { echo "install scripts differ" >&2; exit 1; }

INSTALL_DIR="$TMP_DIR/default-install"
PATH="$FAKE_BIN:$PATH" \
ABADA_TEST_MARKER="$MARKER" \
ABADA_TEST_REAL_CURL="$REAL_CURL" \
ABADA_LLM_GEMINI_API_KEY="test_gemini_key_1234567890" \
ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR/" \
ABADA_INSTALL_DIR="$INSTALL_DIR" \
  bash "$ROOT_DIR/install/install.sh" >"$INSTALL_OUTPUT" 2>&1

[[ "$(cat "$MARKER")" == "up dev" ]] || { echo "marker mismatch: $(cat "$MARKER" 2>/dev/null || echo '<missing>')" >&2; exit 1; }
[[ -x "$INSTALL_DIR/release/abada-platform" ]] || { echo "abada-platform not executable" >&2; exit 1; }
[[ ! -e "$INSTALL_DIR/$ARCHIVE" ]] || { echo "archive not cleaned up" >&2; exit 1; }
[[ "$(awk -F= '$1 == "ABADA_INSIGHT_ENABLED" { print $2 }' "$INSTALL_DIR/.env.dev")" == "true" ]] || { echo "ABADA_INSIGHT_ENABLED not set to true" >&2; exit 1; }
[[ "$(awk -F= '$1 == "ABADA_INSIGHT_LLM_TIMEOUT_MS" { print $2 }' "$INSTALL_DIR/.env.dev")" == "90000" ]] || { echo "ABADA_INSIGHT_LLM_TIMEOUT_MS mismatch" >&2; exit 1; }
grep -Fq 'Initialize: alice / alice' "$INSTALL_OUTPUT" || { echo "missing Initialize line in install output" >&2; cat "$INSTALL_OUTPUT" >&2; exit 1; }
grep -Fq 'HIGH review: bob / bob' "$INSTALL_OUTPUT" || { echo "missing HIGH review line in install output" >&2; cat "$INSTALL_OUTPUT" >&2; exit 1; }
[[ "$(awk -F= '$1 == "ABADA_LLM_GEMINI_API_KEY" { print $2 }' "$INSTALL_DIR/.env.dev")" == "test_gemini_key_1234567890" ]] || { echo "ABADA_LLM_GEMINI_API_KEY mismatch" >&2; exit 1; }
[[ "$(awk -F= '$1 == "ABADA_LLM_API_KEY" { print $2 }' "$INSTALL_DIR/.env.dev")" == "" ]] || { echo "the key must only be written to ABADA_LLM_GEMINI_API_KEY" >&2; exit 1; }
if stat -c '%a' "$INSTALL_DIR/.env.dev" >/dev/null 2>&1; then
  ACTUAL_PERMS="$(stat -c '%a' "$INSTALL_DIR/.env.dev")"
else
  ACTUAL_PERMS="$(stat -f '%Lp' "$INSTALL_DIR/.env.dev")"
fi
[[ "$ACTUAL_PERMS" == "600" ]] || { echo "env.dev permissions not 600" >&2; exit 1; }
if grep -Fq 'test_gemini_key_1234567890' "$INSTALL_OUTPUT"; then
  echo "Installer exposed the Gemini credential in its output" >&2
  exit 1
fi

# `curl ... | bash`: the installer is read from stdin while it runs. A command in
# `up dev` that reads stdin must not swallow the rest of the script, so the final
# instructions are still printed.
PIPED_OUTPUT="$TMP_DIR/piped-output"
PATH="$FAKE_BIN:$PATH" \
ABADA_TEST_MARKER="$MARKER" \
ABADA_TEST_REAL_CURL="$REAL_CURL" \
ABADA_TEST_READ_STDIN=1 \
ABADA_VERSION="$VERSION" \
ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR" \
ABADA_INSTALL_DIR="$TMP_DIR/piped-install" \
  bash <"$ROOT_DIR/install/install.sh" >"$PIPED_OUTPUT" 2>&1
[[ "$(cat "$MARKER")" == "up dev" ]] || { echo "piped install did not start the platform" >&2; exit 1; }
grep -Fq 'HIGH review: bob / bob' "$PIPED_OUTPUT" || {
  echo "piped install stopped before its final instructions" >&2
  cat "$PIPED_OUTPUT" >&2
  exit 1
}

# Re-running the installer over an earlier installation updates it: the
# release's image tags replace the old ones (an old .env.dev must not start the
# old version), the operator's settings stay, new settings are added, and the
# previous file is kept as a backup.
UPGRADE_DIR="$TMP_DIR/upgrade-install"
mkdir -p "$UPGRADE_DIR"
printf '%s\n' 'ABADA_ENGINE_IMAGE=ghcr.io/bashizip/abada-engine:1.0.0-rc.3' \
  'ABADA_STUDIO_IMAGE=ghcr.io/bashizip/abada-studio:1.0.0-rc.3' \
  'POSTGRES_PASSWORD=operator-chosen' 'ABADA_OPERATOR_ONLY=kept' >"$UPGRADE_DIR/.env.dev"
chmod 600 "$UPGRADE_DIR/.env.dev"
PATH="$FAKE_BIN:$PATH" \
ABADA_TEST_MARKER="$MARKER" \
ABADA_TEST_REAL_CURL="$REAL_CURL" \
ABADA_VERSION="$VERSION" \
ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR" \
ABADA_INSTALL_DIR="$UPGRADE_DIR" \
  bash <"$ROOT_DIR/install/install.sh" >"$TMP_DIR/upgrade-output" 2>&1
upgraded() { awk -F= -v key="$1" '$1 == key { print substr($0, length(key) + 2) }' "$UPGRADE_DIR/.env.dev"; }
[[ "$(upgraded ABADA_ENGINE_IMAGE)" == "ghcr.io/bashizip/abada-engine:${VERSION}" ]] || {
  echo "an update must run the installed release's engine image, not the old one" >&2; cat "$UPGRADE_DIR/.env.dev" >&2; exit 1; }
[[ "$(upgraded ABADA_STUDIO_IMAGE)" == "ghcr.io/bashizip/abada-studio:${VERSION}" ]] || {
  echo "an update must run the installed release's Studio image" >&2; exit 1; }
[[ "$(upgraded POSTGRES_PASSWORD)" == "operator-chosen" ]] || { echo "an update must keep the operator's settings" >&2; exit 1; }
[[ "$(upgraded ABADA_OPERATOR_ONLY)" == "kept" ]] || { echo "an update must keep settings the template does not know" >&2; exit 1; }
[[ "$(upgraded ABADA_NEW_SETTING)" == "default-value" ]] || { echo "an update must add settings the release introduced" >&2; exit 1; }
[[ "$(grep -c '^POSTGRES_PASSWORD=' "$UPGRADE_DIR/.env.dev")" == "1" ]] || { echo "an update must not duplicate settings" >&2; exit 1; }
ls "$UPGRADE_DIR"/.env.dev.backup-* >/dev/null 2>&1 || { echo "an update must keep the previous settings file" >&2; exit 1; }
grep -q 'ABADA_ENGINE_IMAGE=ghcr.io/bashizip/abada-engine:1.0.0-rc.3' "$UPGRADE_DIR"/.env.dev.backup-* || {
  echo "the backup must hold the previous settings" >&2; exit 1; }
grep -Fq "from 1.0.0-rc.3 to ${VERSION}" "$TMP_DIR/upgrade-output" || {
  echo "the installer must say it updates an existing installation" >&2; cat "$TMP_DIR/upgrade-output" >&2; exit 1; }

# Invalid credentials must fail before download without echoing their value.
INVALID_OUTPUT="$TMP_DIR/invalid-key-output"
if PATH="$FAKE_BIN:$PATH" \
  ABADA_TEST_REAL_CURL="$REAL_CURL" \
  ABADA_AGENT_LLM_API_KEY="invalid" \
  ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR/" \
  ABADA_INSTALL_DIR="$TMP_DIR/invalid-install" \
    bash "$ROOT_DIR/install/install.sh" >"$INVALID_OUTPUT" 2>&1; then
  echo "Installer accepted an invalid Gemini credential format" >&2
  exit 1
fi
if grep -Fq 'ABADA_AGENT_LLM_API_KEY=invalid' "$INVALID_OUTPUT"; then
  echo "Installer exposed an invalid Gemini credential in its error output" >&2
  exit 1
fi

# No key at all must succeed: the key is optional and can be added later in
# Studio → Settings, where it is stored encrypted in the database.
NOKEY_DIR="$TMP_DIR/nokey-install"
PATH="$FAKE_BIN:$PATH" \
ABADA_TEST_MARKER="$MARKER" \
ABADA_TEST_REAL_CURL="$REAL_CURL" \
ABADA_VERSION="$VERSION" \
ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR" \
ABADA_INSTALL_DIR="$NOKEY_DIR" \
  bash "$ROOT_DIR/install/install.sh" >"$TMP_DIR/nokey-output" 2>&1 || {
  echo "Installer must not block when no API key is provided" >&2
  cat "$TMP_DIR/nokey-output" >&2
  exit 1
}
[[ "$(cat "$MARKER")" == "up dev" ]] || { echo "no-key marker mismatch" >&2; exit 1; }
[[ "$(awk -F= '$1 == "ABADA_LLM_GEMINI_API_KEY" { print $2 }' "$NOKEY_DIR/.env.dev")" == "" ]] || {
  echo "no-key install must leave ABADA_LLM_GEMINI_API_KEY empty" >&2
  exit 1
}
grep -Fq 'add it in Studio' "$TMP_DIR/nokey-output" || {
  echo "no-key install must tell the user how to add the key later" >&2
  cat "$TMP_DIR/nokey-output" >&2
  exit 1
}

# An explicit version must bypass /latest while retaining checksum validation.
printf '%s\n' 'not-a-version' >"$PUBLIC_DIR/latest"
EXPLICIT_INSTALL_DIR="$TMP_DIR/explicit-install"
PATH="$FAKE_BIN:$PATH" \
ABADA_TEST_MARKER="$MARKER" \
ABADA_TEST_REAL_CURL="$REAL_CURL" \
ABADA_LLM_GEMINI_API_KEY="test_gemini_key_1234567890" \
ABADA_VERSION="$VERSION" \
ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR" \
ABADA_INSTALL_DIR="$EXPLICIT_INSTALL_DIR" \
  bash "$ROOT_DIR/install/install.sh" >/dev/null
[[ "$(cat "$MARKER")" == "up dev" ]] || { echo "marker mismatch: $(cat "$MARKER" 2>/dev/null || echo '<missing>')" >&2; exit 1; }


# --- the anonymous install report ------------------------------------------------
EVENTS="$TMP_DIR/events"
ENDPOINT="http://events.test/v1/install-event"
run_installer() {  # dir, then extra VAR=value settings
  local dir="$1"; shift
  env PATH="$FAKE_BIN:$PATH" ABADA_TEST_MARKER="$MARKER" ABADA_TEST_REAL_CURL="$REAL_CURL" \
    ABADA_TEST_EVENTS="$EVENTS" ABADA_VERSION="$VERSION" ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR" \
    ABADA_INSTALL_DIR="$dir" "$@" bash "$ROOT_DIR/install/install.sh"
}

# A mirror or a test installs without reporting: nothing is sent unless an endpoint is named.
: >"$EVENTS"
run_installer "$TMP_DIR/ping-mirror" >"$TMP_DIR/ping-mirror-output" 2>&1
[[ ! -s "$EVENTS" ]] || { echo "an install from a mirror must not report" >&2; exit 1; }
if grep -Fq 'anonymous report' "$TMP_DIR/ping-mirror-output"; then echo "the notice must not appear when nothing is sent" >&2; exit 1; fi

# A successful install sends exactly one event with the documented fields and nothing else.
: >"$EVENTS"
run_installer "$TMP_DIR/ping-ok" ABADA_USAGE_ENDPOINT="$ENDPOINT" ABADA_LLM_GEMINI_API_KEY="test_gemini_key_1234567890" \
  >"$TMP_DIR/ping-ok-output" 2>&1
[[ "$(wc -l <"$EVENTS" | tr -d ' ')" == "1" ]] || { echo "expected exactly one install event" >&2; cat "$EVENTS" >&2; exit 1; }
EVENT="$(cat "$EVENTS")"
for expected in '"event":"install_succeeded"' "\"version\":\"$VERSION\"" '"profile":"dev"' '"llm_key_provided":true' '"ci":'; do
  [[ "$EVENT" == *"$expected"* ]] || { echo "install event lacks $expected: $EVENT" >&2; exit 1; }
done
UNLISTED="$(printf '%s' "$EVENT" | tr -d '{}' | tr ',' '\n' | sed -E 's/^"([a-z_]+)":.*/\1/' | \
  grep -Evx 'event|version|install_id|os|arch|docker_version|profile|duration_s|llm_key_provided|ci|failed_step' || true)"
[[ -z "$UNLISTED" ]] || { echo "install event carries unlisted fields: $UNLISTED" >&2; exit 1; }
for secret in test_gemini_key_1234567890 "$TMP_DIR" "$(whoami)" "$(hostname)"; do
  [[ "$EVENT" != *"$secret"* ]] || { echo "install event leaks a local value: $secret" >&2; exit 1; }
done
grep -Fq 'anonymous report' "$TMP_DIR/ping-ok-output" || { echo "the installer must say what it sends" >&2; exit 1; }
grep -Fq 'ABADA_USAGE_PING=0' "$TMP_DIR/ping-ok-output" || { echo "the installer must say how to opt out" >&2; exit 1; }
ID_FILE="$TMP_DIR/ping-ok/.abada-install-id"
[[ -s "$ID_FILE" ]] || { echo "install id not kept" >&2; exit 1; }
if stat -c '%a' "$ID_FILE" >/dev/null 2>&1; then ID_PERMS="$(stat -c '%a' "$ID_FILE")"; else ID_PERMS="$(stat -f '%Lp' "$ID_FILE")"; fi
[[ "$ID_PERMS" == "600" ]] || { echo "install id file permissions not 600" >&2; exit 1; }
FIRST_ID="$(tr -d '\n' <"$ID_FILE")"
[[ "$EVENT" == *"\"install_id\":\"$FIRST_ID\""* ]] || { echo "event does not carry the kept install id" >&2; exit 1; }
: >"$EVENTS"
run_installer "$TMP_DIR/ping-ok" ABADA_USAGE_ENDPOINT="$ENDPOINT" >/dev/null 2>&1
[[ "$(cat "$EVENTS")" == *"\"install_id\":\"$FIRST_ID\""* ]] || { echo "a reinstall must keep its install id" >&2; exit 1; }

# Every way to opt out sends nothing and prints no notice.
for optout in ABADA_USAGE_PING=0 ABADA_USAGE_PING=false ABADA_USAGE_PING=no DO_NOT_TRACK=1; do
  : >"$EVENTS"
  run_installer "$TMP_DIR/ping-out-${optout//[^A-Za-z0-9]/_}" ABADA_USAGE_ENDPOINT="$ENDPOINT" "$optout" \
    >"$TMP_DIR/ping-out-output" 2>&1
  [[ ! -s "$EVENTS" ]] || { echo "$optout must stop the report" >&2; exit 1; }
  if grep -Fq 'anonymous report' "$TMP_DIR/ping-out-output"; then echo "$optout must stop the notice" >&2; exit 1; fi
done

# A failed install reports the step that failed, and its exit status is the installer's own.
: >"$EVENTS"
if run_installer "$TMP_DIR/ping-fail" ABADA_USAGE_ENDPOINT="$ENDPOINT" ABADA_AGENT_LLM_API_KEY="invalid" \
  >"$TMP_DIR/ping-fail-output" 2>&1; then
  echo "an invalid key must still fail the installer" >&2; exit 1
fi
[[ "$(cat "$EVENTS")" == *'"event":"install_failed"'* && "$(cat "$EVENTS")" == *'"failed_step":"validate_key"'* ]] || {
  echo "a failed install must report its failing step: $(cat "$EVENTS")" >&2; exit 1; }

# An unreachable endpoint never changes the outcome of the install.
: >"$EVENTS"
run_installer "$TMP_DIR/ping-down" ABADA_USAGE_ENDPOINT="$ENDPOINT" ABADA_TEST_PING_FAIL=1 >/dev/null 2>&1 || {
  echo "a failing report must not fail the installer" >&2; exit 1; }
[[ "$(cat "$MARKER")" == "up dev" ]] || { echo "the stack must still start when the report fails" >&2; exit 1; }

# The standalone quickstart shares the same public distribution and checksum
# contract.
QUICKSTART_INSTALL_DIR="$TMP_DIR/quickstart-install"
PATH="$FAKE_BIN:$PATH" \
ABADA_TEST_MARKER="$MARKER" \
ABADA_TEST_REAL_CURL="$REAL_CURL" \
ABADA_VERSION="$VERSION" \
ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR" \
ABADA_INSTALL_DIR="$QUICKSTART_INSTALL_DIR" \
  bash "$ROOT_DIR/release/quickstart.sh" >/dev/null
[[ "$(cat "$MARKER")" == "up dev" ]] || { echo "marker mismatch: $(cat "$MARKER" 2>/dev/null || echo '<missing>')" >&2; exit 1; }

# Corrupted downloads must never be extracted or started.
printf '%s\n' 'corrupt' >>"$PUBLIC_DIR/$ARCHIVE"
rm -f "$MARKER"
if PATH="$FAKE_BIN:$PATH" \
  ABADA_TEST_MARKER="$MARKER" \
  ABADA_TEST_REAL_CURL="$REAL_CURL" \
  ABADA_LLM_GEMINI_API_KEY="test_gemini_key_1234567890" \
  ABADA_VERSION="$VERSION" \
  ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR" \
  ABADA_INSTALL_DIR="$TMP_DIR/corrupt-install" \
    bash "$ROOT_DIR/install/install.sh" >/dev/null 2>&1; then
  echo "Installer accepted a bundle whose checksum did not match" >&2
  exit 1
fi
[[ ! -e "$MARKER" ]] || { echo "marker should not exist after corrupt install" >&2; exit 1; }

grep -A2 '^/install\.sh$' "$ROOT_DIR/install/public/_headers" | \
  grep -q 'Cache-Control: public, max-age=300'

echo "Installer distribution contract passed"
