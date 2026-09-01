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
  'ABADA_INSIGHT_ENABLED=false' 'ABADA_STARTER_WORKFLOW_ENABLED=true' \
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

cmp "$ROOT_DIR/install/install.sh" "$ROOT_DIR/install/public/install.sh"

INSTALL_DIR="$TMP_DIR/default-install"
PATH="$FAKE_BIN:$PATH" \
ABADA_TEST_MARKER="$MARKER" \
ABADA_TEST_REAL_CURL="$REAL_CURL" \
ABADA_AGENT_LLM_API_KEY="test_gemini_key_1234567890" \
ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR/" \
ABADA_INSTALL_DIR="$INSTALL_DIR" \
  bash "$ROOT_DIR/install/install.sh" >"$INSTALL_OUTPUT" 2>&1

[[ "$(cat "$MARKER")" == "up dev" ]]
[[ -x "$INSTALL_DIR/release/abada-platform" ]]
[[ ! -e "$INSTALL_DIR/$ARCHIVE" ]]
[[ "$(awk -F= '$1 == "ABADA_INSIGHT_ENABLED" { print $2 }' "$INSTALL_DIR/.env.dev")" == "true" ]]
[[ "$(awk -F= '$1 == "ABADA_AGENT_LLM_API_KEY" { print $2 }' "$INSTALL_DIR/.env.dev")" == "test_gemini_key_1234567890" ]]
[[ "$(awk -F= '$1 == "ABADA_AGENT_OPENAI_API_KEY" { print $2 }' "$INSTALL_DIR/.env.dev")" == "test_gemini_key_1234567890" ]]
[[ "$(awk -F= '$1 == "ABADA_LLM_API_KEY" { print $2 }' "$INSTALL_DIR/.env.dev")" == "test_gemini_key_1234567890" ]]
[[ "$(stat -f '%Lp' "$INSTALL_DIR/.env.dev" 2>/dev/null || stat -c '%a' "$INSTALL_DIR/.env.dev")" == "600" ]]
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
[[ "$(cat "$MARKER")" == "up dev" ]]

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
[[ "$(cat "$MARKER")" == "up dev" ]]

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
[[ ! -e "$MARKER" ]]

grep -A2 '^/install\.sh$' "$ROOT_DIR/install/public/_headers" | \
  grep -q 'Cache-Control: public, max-age=300'

echo "Installer distribution contract passed"
