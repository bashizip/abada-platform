#!/usr/bin/env bash
# Google Compute Engine startup script for a single-VM Abada server.
#
# Runs as root on every boot of a Debian 12 or Ubuntu 22.04/24.04 VM and is
# idempotent: it installs Docker Engine with the Compose plugin, downloads and
# verifies the Abada release bundle into /opt/abada, and creates .env.server
# from instance metadata. It starts the stack only when the metadata attribute
# abada-autostart is "true"; otherwise sign in and run
#   sudo /opt/abada/release/abada-platform up server
#
# Instance metadata attributes (all optional):
#   abada-version     exact release, e.g. 1.0.0-rc.8 (default: published latest)
#   abada-domain      ABADA_DOMAIN, e.g. demo.abadaplatform.com
#   abada-acme-email  ABADA_ACME_EMAIL for Let's Encrypt
#   abada-autostart   "true" to run `up server` after installation
#
# See docs/operations/gcp-vm.md.
set -euo pipefail

INSTALL_DIR="${ABADA_INSTALL_DIR:-/opt/abada}"
BASE_URL="${ABADA_RELEASE_BASE_URL:-https://install.abadaplatform.com}"
BASE_URL="${BASE_URL%/}"
METADATA_URL="http://metadata.google.internal/computeMetadata/v1/instance/attributes"

log() { printf '[abada-startup] %s\n' "$*"; }

metadata() {
  curl --fail --silent --header 'Metadata-Flavor: Google' "$METADATA_URL/$1" 2>/dev/null || true
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return 0
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  case "$ID" in
    debian|ubuntu) ;;
    *) log "Unsupported OS '$ID'; install Docker Engine and the Compose plugin manually."; exit 69 ;;
  esac
  log "Installing Docker Engine from download.docker.com..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
}

install_bundle() {
  local version="$1" archive tmp_dir line
  archive="abada-platform-$version.tar.gz"
  if [[ -f "$INSTALL_DIR/.abada-version" && "$(cat "$INSTALL_DIR/.abada-version")" == "$version" ]]; then
    log "Abada $version is already installed in $INSTALL_DIR."
    return 0
  fi
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN
  log "Downloading Abada $version..."
  curl --fail --location --silent --show-error "$BASE_URL/$archive" -o "$tmp_dir/$archive"
  curl --fail --location --silent --show-error "$BASE_URL/$archive.sha256" -o "$tmp_dir/$archive.sha256"
  line="$(cat "$tmp_dir/$archive.sha256")"
  if [[ "$(awk 'END { print NR }' "$tmp_dir/$archive.sha256")" != "1" ||
        ! "$line" =~ ^[0-9a-fA-F]{64}[[:space:]][[:space:]]"$archive"$ ]]; then
    log "Checksum file must contain exactly the expected archive entry."
    exit 65
  fi
  (cd "$tmp_dir" && sha256sum --check --quiet "$archive.sha256")
  mkdir -p "$INSTALL_DIR"
  # Extraction replaces release files only; .env.server and volumes are kept.
  tar -xzf "$tmp_dir/$archive" --strip-components=1 -C "$INSTALL_DIR"
  printf '%s\n' "$version" >"$INSTALL_DIR/.abada-version"
  log "Verified and installed Abada $version in $INSTALL_DIR."
}

set_env_value() {
  local file="$1" key="$2" value="$3"
  [[ -n "$value" ]] || return 0
  if grep -q "^$key=" "$file"; then
    sed -i "s|^$key=.*|$key=$value|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

main() {
  local version domain acme_email autostart env_file
  install_docker

  version="$(metadata abada-version)"
  if [[ -z "$version" ]]; then
    version="$(curl --fail --location --silent --show-error "$BASE_URL/latest")"
  fi
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || {
    log "Version must be an immutable semantic version: '$version'"
    exit 64
  }
  install_bundle "$version"

  env_file="$INSTALL_DIR/.env.server"
  if [[ ! -f "$env_file" ]]; then
    (umask 077 && cp "$INSTALL_DIR/release/.env.server.example" "$env_file")
  fi
  domain="$(metadata abada-domain)"
  acme_email="$(metadata abada-acme-email)"
  set_env_value "$env_file" ABADA_DOMAIN "$domain"
  set_env_value "$env_file" ABADA_ACME_EMAIL "$acme_email"
  # Keep the pinned images on the installed release, so changing the
  # abada-version metadata and rebooting (or rerunning this script) upgrades.
  local image
  for image in engine studio docs agent-worker; do
    set_env_value "$env_file" "ABADA_$(tr 'a-z-' 'A-Z_' <<<"$image")_IMAGE" "ghcr.io/bashizip/abada-$image:$version"
  done
  chmod 600 "$env_file"

  autostart="$(metadata abada-autostart)"
  if [[ "$autostart" == "true" ]]; then
    log "Starting the Abada server profile..."
    "$INSTALL_DIR/release/abada-platform" up server
  else
    log "Installed. Review $env_file, then run: sudo $INSTALL_DIR/release/abada-platform up server"
  fi
}

main "$@"
