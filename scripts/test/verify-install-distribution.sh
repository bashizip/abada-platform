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
printf '%s\n' 'ABADA_AGENT_LLM_API_KEY=' 'ABADA_AGENT_OPENAI_API_KEY=' \
  'ABADA_LLM_API_KEY=' 'ABADA_LLM_BASE_URL=' 'ABADA_LLM_MODEL=gemini-3.6-flash' \
  'ABADA_INSIGHT_ENABLED=false' 'ABADA_INSIGHT_LLM_TIMEOUT_MS=90000' \
  'ABADA_STARTER_WORKFLOW_ENABLED=true' \
  >"$STAGING_DIR/release/.env.dev.example"

cat >"$STAGING_DIR/release/abada-platform" <<'FIXTURE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >"${ABADA_TEST_MARKER:?}"
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
exec "${ABADA_TEST_REAL_CURL:?}" "$@"
FIXTURE
chmod +x "$FAKE_BIN/curl"

cmp "$ROOT_DIR/install/install.sh" "$ROOT_DIR/install/public/install.sh" || { echo "install scripts differ" >&2; exit 1; }

INSTALL_DIR="$TMP_DIR/default-install"
PATH="$FAKE_BIN:$PATH" \
ABADA_TEST_MARKER="$MARKER" \
ABADA_TEST_REAL_CURL="$REAL_CURL" \
ABADA_AGENT_LLM_API_KEY="test_gemini_key_1234567890" \
ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR/" \
ABADA_INSTALL_DIR="$INSTALL_DIR" \
  bash "$ROOT_DIR/install/install.sh" >"$INSTALL_OUTPUT" 2>&1

[[ "$(cat "$MARKER")" == "up dev" ]] || { echo "marker mismatch: $(cat "$MARKER" 2>/dev/null || echo '<missing>')" >&2; exit 1; }
[[ -x "$INSTALL_DIR/release/abada-platform" ]] || { echo "abada-platform not executable" >&2; exit 1; } || { echo "abada-platform not executable" >&2; exit 1; }
[[ ! -e "$INSTALL_DIR/$ARCHIVE" ]] || { echo "archive not cleaned up" >&2; exit 1; } || { echo "archive not cleaned up" >&2; exit 1; }
[[ "$(awk -F= '$1 == "ABADA_INSIGHT_ENABLED" { print $2 }' "$INSTALL_DIR/.env.dev")" == "true" ]] || { echo "ABADA_INSIGHT_ENABLED not set to true" >&2; exit 1; } || { echo "ABADA_INSIGHT_ENABLED not set to true" >&2; exit 1; }
[[ "$(awk -F= '$1 == "ABADA_INSIGHT_LLM_TIMEOUT_MS" { print $2 }' "$INSTALL_DIR/.env.dev")" == "90000" ]] || { echo "ABADA_INSIGHT_LLM_TIMEOUT_MS mismatch" >&2; exit 1; } || { echo "ABADA_INSIGHT_LLM_TIMEOUT_MS mismatch" >&2; exit 1; }
grep -Fq 'Initialize: alice / alice' "$INSTALL_OUTPUT" || { echo "missing Initialize line in install output" >&2; cat "$INSTALL_OUTPUT" >&2; exit 1; }
grep -Fq 'HIGH review: bob / bob' "$INSTALL_OUTPUT" || { echo "missing HIGH review line in install output" >&2; cat "$INSTALL_OUTPUT" >&2; exit 1; }
[[ "$(awk -F= '$1 == "ABADA_AGENT_LLM_API_KEY" { print $2 }' "$INSTALL_DIR/.env.dev")" == "test_gemini_key_1234567890" ]] || { echo "ABADA_AGENT_LLM_API_KEY mismatch" >&2; exit 1; } || { echo "ABADA_AGENT_LLM_API_KEY mismatch" >&2; exit 1; }
[[ "$(awk -F= '$1 == "ABADA_AGENT_OPENAI_API_KEY" { print $2 }' "$INSTALL_DIR/.env.dev")" == "test_gemini_key_1234567890" ]] || { echo "ABADA_AGENT_OPENAI_API_KEY mismatch" >&2; exit 1; } || { echo "ABADA_AGENT_OPENAI_API_KEY mismatch" >&2; exit 1; }
[[ "$(awk -F= '$1 == "ABADA_LLM_API_KEY" { print $2 }' "$INSTALL_DIR/.env.dev")" == "test_gemini_key_1234567890" ]] || { echo "ABADA_LLM_API_KEY mismatch" >&2; exit 1; } || { echo "ABADA_LLM_API_KEY mismatch" >&2; exit 1; }
if stat -c '%a' "$INSTALL_DIR/.env.dev" >/dev/null 2>&1; then
  ACTUAL_PERMS="$(stat -c '%a' "$INSTALL_DIR/.env.dev")"
else
  ACTUAL_PERMS="$(stat -f '%Lp' "$INSTALL_DIR/.env.dev")"
fi
[[ "$ACTUAL_PERMS" == "600" ]] || { echo "env.dev permissions not 600 (got: $ACTUAL_PERMS)" >&2; exit 1; } || { echo "env.dev permissions not 600" >&2; exit 1; }
if grep -Fq 'test_gemini_key_1234567890' "$INSTALL_OUTPUT"; then
  echo "Installer exposed the Gemini credential in its output" >&2
  exit 1
fi

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

# An explicit version must bypass /latest while retaining checksum validation.
printf '%s\n' 'not-a-version' >"$PUBLIC_DIR/latest"
EXPLICIT_INSTALL_DIR="$TMP_DIR/explicit-install"
PATH="$FAKE_BIN:$PATH" \
ABADA_TEST_MARKER="$MARKER" \
ABADA_TEST_REAL_CURL="$REAL_CURL" \
ABADA_AGENT_LLM_API_KEY="test_gemini_key_1234567890" \
ABADA_VERSION="$VERSION" \
ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR" \
ABADA_INSTALL_DIR="$EXPLICIT_INSTALL_DIR" \
  bash "$ROOT_DIR/install/install.sh" >/dev/null
[[ "$(cat "$MARKER")" == "up dev" ]] || { echo "marker mismatch: $(cat "$MARKER" 2>/dev/null || echo '<missing>')" >&2; exit 1; }

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
  ABADA_AGENT_LLM_API_KEY="test_gemini_key_1234567890" \
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
