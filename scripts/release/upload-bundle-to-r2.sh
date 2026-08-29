#!/usr/bin/env bash
# scripts/release/upload-bundle-to-r2.sh
#
# Manually upload a release bundle (and its SHA-256 checksum) to the
# Cloudflare R2 bucket that backs install.abadaplatform.com.
#
# Use this to:
#   • Back-fill existing bundles (e.g. 1.0.0-rc.3) before the CI workflow
#     exists for those tags.
#   • Re-upload a bundle in an emergency if CI is unavailable.
#
# Prerequisites
#   • Node.js/npm and a Wrangler login (run: npx wrangler login)
#   • R2 enabled on the Cloudflare account (Dashboard → R2 → Enable)
#
# Required env vars  (or wrangler's own OAuth session if logged in locally)
#   CLOUDFLARE_API_TOKEN   — API token with Workers R2 Storage: Edit
#   CLOUDFLARE_ACCOUNT_ID  — Cloudflare Account ID
#
# Usage
#   ./scripts/release/upload-bundle-to-r2.sh VERSION [DIST_DIR]
#
# Examples
#   ./scripts/release/upload-bundle-to-r2.sh 1.0.0-rc.3
#   ./scripts/release/upload-bundle-to-r2.sh 1.0.0-rc.3 /tmp/my-dist

set -euo pipefail

VERSION="${1:?Usage: $0 VERSION [DIST_DIR]}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || {
  echo "Error: VERSION must be an exact immutable semantic version" >&2
  exit 64
}

DIST_DIR="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../release/dist" && pwd)}"
R2_BUCKET="${ABADA_R2_BUCKET:-abada-releases}"
WRANGLER_VERSION="4.78.0"
WRANGLER=(npx --yes "wrangler@${WRANGLER_VERSION}")

BUNDLE="${DIST_DIR}/abada-platform-${VERSION}.tar.gz"
CHECKSUM="${BUNDLE}.sha256"

if [[ ! -f "$BUNDLE" ]]; then
  echo "Error: bundle not found at ${BUNDLE}" >&2
  echo "Run: ./release/build-bundle.sh ${VERSION}" >&2
  exit 1
fi
if [[ ! -f "$CHECKSUM" ]]; then
  echo "Error: checksum not found at ${CHECKSUM}" >&2
  exit 1
fi

CHECKSUM_LINE="$(cat "$CHECKSUM")"
if [[ "$(awk 'END { print NR }' "$CHECKSUM")" != "1" ]]; then
  echo "Error: checksum file must contain exactly the expected archive entry" >&2
  exit 65
fi
if [[ ! "$CHECKSUM_LINE" =~ ^([0-9a-fA-F]{64})[[:space:]][[:space:]](.+)$ ]]; then
  echo "Error: checksum file must contain exactly the expected archive entry" >&2
  exit 65
fi
if [[ "${BASH_REMATCH[2]}" != "$(basename "$BUNDLE")" ]]; then
  echo "Error: checksum file must contain exactly the expected archive entry" >&2
  exit 65
fi

(
  cd "$DIST_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check "$(basename "$CHECKSUM")"
  else
    shasum -a 256 --check "$(basename "$CHECKSUM")"
  fi
)

upload_archive() {
  "${WRANGLER[@]}" r2 object put \
    "${R2_BUCKET}/abada-platform-${VERSION}.tar.gz" \
    --remote \
    --file "$BUNDLE" \
    --content-type application/gzip \
    --cache-control "public, max-age=31536000, immutable"
}

upload_checksum() {
  "${WRANGLER[@]}" r2 object put \
    "${R2_BUCKET}/abada-platform-${VERSION}.tar.gz.sha256" \
    --remote \
    --file "$CHECKSUM" \
    --content-type "text/plain; charset=utf-8" \
    --cache-control "public, max-age=31536000, immutable"
}

# A versioned key is immutable. A retry may reuse byte-identical objects, but
# publishing different bytes under an existing version is always an error.
REMOTE_CHECKSUM=""
if REMOTE_CHECKSUM="$(
  "${WRANGLER[@]}" r2 object get \
    "${R2_BUCKET}/abada-platform-${VERSION}.tar.gz.sha256" \
    --remote --pipe 2>/dev/null
)"; then
  LOCAL_CHECKSUM="$(tr -d '\r\n' <"$CHECKSUM")"
  if [[ "$REMOTE_CHECKSUM" != "$LOCAL_CHECKSUM" ]]; then
    echo "Error: R2 already contains a different checksum for ${VERSION}; refusing to overwrite an immutable release" >&2
    exit 65
  fi

  REMOTE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/abada-r2-check.XXXXXX")"
  trap 'rm -rf "$REMOTE_DIR"' EXIT
  if "${WRANGLER[@]}" r2 object get \
      "${R2_BUCKET}/abada-platform-${VERSION}.tar.gz" \
      --remote --file "$REMOTE_DIR/$(basename "$BUNDLE")" >/dev/null 2>&1; then
    REMOTE_HASH="$(
      if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$REMOTE_DIR/$(basename "$BUNDLE")" | awk '{ print $1 }'
      else
        shasum -a 256 "$REMOTE_DIR/$(basename "$BUNDLE")" | awk '{ print $1 }'
      fi
    )"
    LOCAL_HASH="${LOCAL_CHECKSUM%% *}"
    if [[ "$REMOTE_HASH" != "$LOCAL_HASH" ]]; then
      echo "Error: R2 archive bytes do not match the existing ${VERSION} checksum" >&2
      exit 65
    fi
    echo "R2 already contains the byte-identical ${VERSION} bundle; upload skipped."
    exit 0
  fi

  echo "Error: R2 checksum exists but its archive could not be read; refusing an unverifiable overwrite" >&2
  exit 69
fi

echo "Uploading abada-platform-${VERSION}.tar.gz → R2:${R2_BUCKET}"

upload_archive
upload_checksum

echo ""
echo "Done. Verify with:"
echo "  curl -fsI https://install.abadaplatform.com/abada-platform-${VERSION}.tar.gz"
