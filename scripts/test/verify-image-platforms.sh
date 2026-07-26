#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 IMAGE [IMAGE ...]" >&2
  exit 64
fi

command -v docker >/dev/null 2>&1 || {
  echo "Error: docker is required to inspect image manifests" >&2
  exit 69
}

for image in "$@"; do
  manifest="$(docker buildx imagetools inspect "$image")"
  if ! grep -Eq 'Platform:[[:space:]]+linux/amd64$' <<<"$manifest"; then
    echo "Error: $image does not publish linux/amd64" >&2
    exit 1
  fi
  if ! grep -Eq 'Platform:[[:space:]]+linux/arm64(/v8)?$' <<<"$manifest"; then
    echo "Error: $image does not publish linux/arm64" >&2
    exit 1
  fi
  echo "Verified $image: linux/amd64, linux/arm64"
done
