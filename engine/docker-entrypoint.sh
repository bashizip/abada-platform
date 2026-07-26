#!/bin/sh
set -eu

# Fix permissions for mounted volumes
# This is needed because volume mounts can override permissions set in Dockerfile
# Create directories if they don't exist (for bind mounts)
mkdir -p /app/data /app/logs

# Fix ownership for Docker-managed volumes before dropping privileges.
fix_permissions() {
    local dir=$1
    if [ -d "$dir" ]; then
        chown -R appuser:appgroup "$dir" || {
            echo "Error: cannot assign $dir to the non-root engine user" >&2
            exit 73
        }
        chmod -R u=rwX,g=rX,o=rX "$dir" || {
            echo "Error: cannot secure permissions for $dir" >&2
            exit 73
        }
    fi
}

fix_permissions /app/data
fix_permissions /app/logs

# Switch to appuser and execute the main command
exec su-exec appuser "$@"
