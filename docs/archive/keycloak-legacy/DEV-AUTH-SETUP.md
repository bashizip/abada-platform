# Keycloak Authentication - Dev Stack Quick Start

## What Changed

**Phase 1 Implementation** has been completed for the `dev` environment:

1. ✅ **Traefik Gateway** added to dev profile (port 80)
2. ✅ **OAuth2 Proxy** added for JWT validation
3. ✅ **Engine** now routes through Traefik (port 5601 no longer exposed directly)
4. ✅ **IdentityContextInterceptor** updated to support oauth2-proxy headers

## How to Use

### 1. Setup Environment Variables

Copy the example environment file:
```bash
cp env.example .env
```

The file contains:
- `OAUTH2_PROXY_CLIENT_ID`: Keycloak client ID (default: `abada-frontend`)
- `OAUTH2_PROXY_CLIENT_SECRET`: Client secret (default: `dev-secret`)
- `OAUTH2_PROXY_COOKIE_SECRET`: 32-character cookie encryption key
- `KEYCLOAK_ADMIN_USERNAME`: Keycloak admin user (default: `admin`)
- `KEYCLOAK_ADMIN_PASSWORD`: Keycloak admin password (default: `admin`)

### 2. Start the Dev Stack

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### 3. Access Points

| Service | URL | Purpose |
|---------|-----|---------|
| **Engine (via Traefik)** | http://localhost/api | Main API (authenticated) |
| **Keycloak Admin** | http://localhost:8080 | Identity management |
| **Traefik Dashboard** | http://localhost:8081 | Gateway monitoring |
| **Grafana** | http://localhost:3000 | Observability |

> **Note**: The engine is NO LONGER accessible directly on port 5601. All requests must go through Traefik on port 80.

### 4. Test Authentication

#### Get a Token from Keycloak

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/real ms/abada-dev/protocol/openid-connect/token \
  -d "client_id=abada-frontend" \
  -d "username=alice" \
  -d "password=alice" \
  -d "grant_type=password" | jq -r .access_token)

echo "Token: $TOKEN"
```

#### Call the Engine with the Token

```bash
# This should work (authenticated via oauth2-proxy)
curl -v http://localhost/api/tasks \
  -H "Authorization: Bearer $TOKEN"

# Check the response - should show tasks for alice
```

#### Verify Headers are Injected

Check the engine logs to confirm oauth2-proxy is injecting headers:

```bash
docker logs abada-engine 2>&1 | grep -E "(X-Auth-Request-User|X-Auth-Request-Groups)"
```

You should see logs showing:
- `X-Auth-Request-User: alice`
- `X-Auth-Request-Groups: managers`

### 5. Test Security

#### Invalid Token (should fail)

```bash
curl -v http://localhost/api/tasks \
  -H "Authorization: Bearer invalid_token"
# Expected: 401 Unauthorized or 403 Forbidden
```

#### No Token (should redirect to login)

```bash
curl -v http://localhost/api/tasks
# Expected: 302 redirect or 401 Unauthorized
```

#### Direct Access Blocked

```bash
# This should FAIL (port not exposed)
curl http://localhost:5601/api/tasks
# Expected: Connection refused
```

## Available Test Users

From `docker/keycloak/import/realm-dev.json`:

| Username | Password | Groups |
|----------|----------|--------|
| alice | alice | customers |
| bob | bob | cuistos |
| orun-admin | orun-admin | orun-admin |

## Troubleshooting

### oauth2-proxy not starting

Check if the cookie secret is valid (must be 32 characters):
```bash
docker logs oauth2-proxy-dev
```

Generate a new one if needed:
```bash
openssl rand -base64 32 | tr -d '/+=' | head -c 32
```

### Traefik not routing requests

Check Traefik dashboard: http://localhost:8081

Look for:
- `engine-dev` router (should be active)
- `oauth2-proxy-dev` middleware (should be attached)

### Keycloak not accessible

Verify Keycloak is running:
```bash
docker logs keycloak
```

Wait for: "Keycloak ... started in ..."

### Can't get tokens

1. Check Keycloak admin console: http://localhost:8080
2. Verify realm `abada-dev` exists
3. Check client `abada-frontend` is enabled
4. Verify users alice/bob exist

## Architecture

```
User → Traefik (port 80)
         ↓
    OAuth2-Proxy (validates JWT)
         ↓
    Injects headers:
    - X-Auth-Request-User
    - X-Auth-Request-Groups  
         ↓
    Abada Engine (port 5601, internal only)
```

## Next Steps

- [ ] Test authentication flow end-to-end
- [ ] Add similar setup to test profile
- [ ] Configure production Keycloak
- [ ] Implement network segmentation
- [ ] Add frontend integration (Tenda/Orun)

## Rollback

If you need to revert to direct access:

```bash
git checkout docker-compose.dev.yml src/main/java/com/abada/engine/security/IdentityContextInterceptor.java
```

This will restore direct port 5601 access without authentication.
