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

mkdir -p "$PUBLIC_DIR" "$STAGING_DIR/release" "$FAKE_BIN"
printf '%s\n' "$VERSION" >"$PUBLIC_DIR/latest"

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

cmp "$ROOT_DIR/install/install.sh" "$ROOT_DIR/install/public/install.sh"

INSTALL_DIR="$TMP_DIR/default-install"
PATH="$FAKE_BIN:$PATH" \
ABADA_TEST_MARKER="$MARKER" \
ABADA_RELEASE_BASE_URL="file://$PUBLIC_DIR/" \
ABADA_INSTALL_DIR="$INSTALL_DIR" \
  bash "$ROOT_DIR/install/install.sh" >/dev/null

[[ "$(cat "$MARKER")" == "up dev" ]]
[[ -x "$INSTALL_DIR/release/abada-platform" ]]
[[ ! -e "$INSTALL_DIR/$ARCHIVE" ]]

# An explicit version must bypass /latest while retaining checksum validation.
printf '%s\n' 'not-a-version' >"$PUBLIC_DIR/latest"
EXPLICIT_INSTALL_DIR="$TMP_DIR/explicit-install"
PATH="$FAKE_BIN:$PATH" \
ABADA_TEST_MARKER="$MARKER" \
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
