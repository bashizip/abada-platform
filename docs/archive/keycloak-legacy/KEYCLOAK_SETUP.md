# Keycloak Setup & Integration Guide

## Development Environment

### Prerequisites
- Docker and Docker Compose
- `.env` file with Keycloak credentials

### Quick Start
```bash
cp env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

### Access Keycloak
- **Admin Console**: http://localhost:8080
- **Default Credentials**: admin / admin

### Test Realm Configuration
- **Realm**: `abada-dev`
- **Test Users**: alice (pwd: alice), bob (pwd: bob)
- **Groups**: managers, customers

## Authentication Flow

1. Frontend → Keycloak OAuth2/OIDC login
2. Keycloak → Issues JWT token
3. Traefik/Gateway → Validates JWT and injects headers
4. Engine → Consumes X-User/X-Groups headers

## Token Generation Example
```bash
curl -X POST http://localhost:8080/realms/abada-dev/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=abada-frontend&username=alice&password=alice&grant_type=password"
```

## Engine API with Headers
The engine is auth-agnostic and expects:
- `X-User` header: username
- `X-Groups` header: comma-separated groups

Example:
```bash
curl -H "X-User: alice" -H "X-Groups: managers" \
  http://localhost:5601/abada/api/v1/processes
```

## Production Considerations
- Use HTTPS (set sslRequired in realm config)
- Store secrets in vault/secrets manager
- Configure Traefik JWT validation middleware
- Use separate Keycloak database instance
- Enable audit logging and monitoring

For architectural details, see docs/architecture/keycloak-integration-plan.md.
