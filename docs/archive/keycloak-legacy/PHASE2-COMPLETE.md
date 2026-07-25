# Phase 2 Complete: Test and Production Authentication

## Summary

Successfully added Keycloak authentication to **test** and **production** profiles.

## Changes Made

### Test Profile (`docker-compose.test.yml`)

✅ Added **Keycloak** with in-memory PostgreSQL (fast tests)  
✅ Added **Traefik** gateway (port 80)  
✅ Added **oauth2-proxy** for JWT validation  
✅ Removed direct engine port exposure  
✅ Uses `realm-dev.json` (test users: alice/bob)

### Production Profile (`docker-compose.prod.yml`)

✅ Added **Keycloak** with persistent PostgreSQL  
✅ Added **oauth2-proxy** with production settings  
✅ Added oauth2-proxy middleware to engine routing  
✅ Created `realm-prod.json` with hardened security:
   - SSL required (`external`)
   - Confidential client (not public)
   - No direct access grants (password flow disabled)
   - PKCE enabled
   - No test users (empty)

✅ Created `env.prod.example` with required variables  
✅ Added `keycloak_data` volume for persistence

## Key Differences: Test vs Prod

| Feature | Test | Production |
|---------|------|------------|
| **Keycloak DB** | In-memory (tmpfs) | Persistent volume |
| **SSL** | Not required | Required (external) |
| **Client Type** | Public | Confidential (secret required) |
| **Test Users** | alice, bob | None (manage via admin) |
| **Restart Policy** | no | always |
| **Cookie Secure** | false | true |
| **HTTPS** | Not required | Required |
| **Realm** | abada-dev | abada-prod |

## Production Deployment Checklist

Before deploying to production:

- [ ] Set all required environment variables in `.env`:
  - `KEYCLOAK_ADMIN_USERNAME`
  - `KEYCLOAK_ADMIN_PASSWORD`
  - `KEYCLOAK_DB_PASSWORD`
  - `KEYCLOAK_HOSTNAME` (e.g., `auth.abada.dev`)
  - `APP_HOSTNAME` (e.g., `app.abada.dev`)
  - `OAUTH2_PROXY_CLIENT_ID`
  - `OAUTH2_PROXY_CLIENT_SECRET`
  - `OAUTH2_PROXY_COOKIE_SECRET` (32 chars)
  - `POSTGRES_PASSWORD`

- [ ] Update `realm-prod.json`:
  - Replace `${APP_HOSTNAME}` with actual domain
  - Set `secret` to match `OAUTH2_PROXY_CLIENT_SECRET`

- [ ] Configure DNS:
  - Point `${KEYCLOAK_HOSTNAME}` to Traefik
  - Point `${APP_HOSTNAME}` to Traefik

- [ ] Configure SSL certificates in Traefik

- [ ] Create production users in Keycloak Admin Console

- [ ] Test authentication flow end-to-end

## Testing Test Profile

```bash
# Start test stack
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d

# Get token
TOKEN=$(curl -s -X POST http://localhost:8080/realms/abada-dev/protocol/openid-connect/token \
  -d "client_id=abada-frontend" \
  -d "username=alice" \
  -d "password=alice" \
  -d "grant_type=password" | jq -r .access_token)

# Test API access
curl http://localhost/api/tasks -H "Authorization: Bearer $TOKEN"
```

## Next Steps

- [P1] Implement network segmentation
- [P1] Remove unnecessary port exposures  
- [P2] Add token revocation
- [P2] Configure rate limiting
- [P2] Add monitoring/alerting for auth failures

## Files Modified

- `docker-compose.test.yml` - Added Keycloak + Traefik + oauth2-proxy
- `docker-compose.prod.yml` - Added Keycloak + oauth2-proxy
- `docker/keycloak/import/realm-dev.json` - Renamed from realm-export.json
- `docker/keycloak/import/realm-prod.json` - NEW: Production realm config
- `env.prod.example` - NEW: Production environment template
