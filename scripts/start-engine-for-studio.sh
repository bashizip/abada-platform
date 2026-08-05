#!/bin/bash

# Ensure we're in the right directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🚀 Starting Abada Engine for Studio local development..."
echo "========================================================"
echo "Profile: dev (uses H2 in-memory database)"
echo "Security: Proxy Mode (no Keycloak required)"
echo "Port: 5601"
echo "========================================================"

cd "$ROOT_DIR/engine" || exit 1

# Start the Spring Boot application using the dev profile
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
