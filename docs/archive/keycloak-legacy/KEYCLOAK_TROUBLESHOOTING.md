# Keycloak Troubleshooting & FAQ

## Common Issues & Solutions

### 1. Container Won't Start: "HTTPS Required"

**Symptom**: Token endpoint returns `{"error": "invalid_request", "error_description": "HTTPS required"}`

**Root Cause**: Realm SSL requirement is set too strict

**Solution**:
```bash
# Update realm with sslRequired: none
# In docker/keycloak/import/realm-export.json:
"sslRequired": "none"

# Then re-import realm
docker exec keycloak /opt/keycloak/bin/kc.sh import --file /tmp/realm-export.json
docker restart keycloak
```

### 2. Keycloak Can't Connect to Database

**Symptom**: Container logs show "connection refused" or "failed to bind"

**Root Cause**: Keycloak-db not started or not accessible

**Solution**:
```bash
# Ensure dependency order
docker compose -f docker-compose.yml -f docker-compose.dev.yml up keycloak-db
docker compose -f docker-compose.yml -f docker-compose.dev.yml up keycloak

# Check db logs
docker logs keycloak-db

# Check network connectivity
docker exec keycloak ping keycloak-db
```

### 3. Engine Returns 403 Even with Valid Headers

**Symptom**: API returns 403 Forbidden with correct X-User/X-Groups headers

**Root Cause**: BPMN task has different candidateGroup or user not in group

**Solution**:
```bash
# Check task assignment rules
curl -s -H "X-User: alice" -H "X-Groups: managers,customers" \
  http://localhost:5601/abada/api/v1/tasks | jq '.[] | {id, assigneeGroups}'

# Verify task requires "managers" group
# Update BPMN if needed: candidateGroups="managers,customers"
```

### 4. Realm Not Imported on Startup

**Symptom**: Keycloak starts but `abada-dev` realm doesn't exist

**Root Cause**: KEYCLOAK_IMPORT variable not set or file not mounted

**Solution**:
```bash
# Check docker-compose config
docker compose config | grep -A 20 keycloak:

# Verify mount exists
docker exec keycloak ls -la /opt/keycloak/data/import/

# Manual import if needed
docker cp docker/keycloak/import/realm-export.json keycloak:/tmp/
docker exec keycloak /opt/keycloak/bin/kc.sh import --file /tmp/realm-export.json
```

### 5. Admin API Returns 401 Unauthorized

**Symptom**: Admin token doesn't work for `/admin/realms` endpoints

**Root Cause**: Different authentication mechanism required for admin APIs

**Solution**:
```bash
# Use admin-cli client with password grant
TOKEN=$(curl -s -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=admin-cli&username=admin&password=admin&grant_type=password" \
  | jq -r '.access_token')

# Verify token is not empty
echo $TOKEN | head -c 50

# Use token
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/admin/realms/abada-dev
```

## Frequently Asked Questions

### Q: Can I use Keycloak with existing external user directory?

**A**: Yes. Configure user federation:
1. Go to Keycloak Admin Console
2. Navigate to User Federation (for LDAP/AD)
3. Configure connection to existing directory
4. Groups can be imported from LDAP

### Q: How do I add new users?

**A**: Two approaches:

1. **Via Admin Console**:
   - http://localhost:8080 → Users → Add user
   - Set password → Email credentials

2. **Via Admin API**:
   ```bash
   TOKEN=$(...)  # Get admin token (see issue 5)
   curl -X POST http://localhost:8080/admin/realms/abada-dev/users \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"username":"newuser","enabled":true}'
   ```

### Q: How do I reset admin password?

**A**: Only in development. Stop containers and restart:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
# .env has new password
docker compose -f docker-compose.yml -f docker-compose.dev.yml up keycloak
```

### Q: Can frontend apps work without Keycloak during development?

**A**: Yes, test with hardcoded headers:
```bash
curl -H "X-User: testuser" -H "X-Groups: testgroup" \
  http://localhost:5601/abada/api/v1/processes
```

### Q: How do I backup the realm?

**A**: Export realm from admin console or via API:
```bash
TOKEN=$(...)  # Get admin token
curl http://localhost:8080/admin/realms/abada-dev/export \
  -H "Authorization: Bearer $TOKEN" > realm-backup.json
```

### Q: What's the performance overhead of Keycloak?

**A**: Negligible for typical workloads:
- Token validation: <1ms (Traefik caches)
- Admin operations: <50ms
- DB queries: <10ms with proper indexing

Monitor with: `docker stats keycloak`

### Q: Can I run multiple Keycloak instances?

**A**: Yes, for HA:
- Use external PostgreSQL
- Configure all instances with same DB connection
- Use load balancer (Traefik) in front

## Performance Tuning

### Database Connection Pooling
```sql
-- Increase connections in postgres.yml
max_connections = 200
shared_buffers = 256MB
```

### Keycloak Cache Settings
Set environment variables:
```bash
KC_CACHE=ispn
KC_CACHE_STACK=kubernetes  # or tcp for docker compose
```

### Token Caching
Traefik should cache validated tokens to avoid re-validation

## Logs & Debugging

### View Keycloak Logs
```bash
docker logs keycloak -f  # Follow logs
docker logs keycloak --tail 100  # Last 100 lines
docker logs keycloak | grep ERROR  # Error lines only
```

### Enable Debug Logging
```bash
docker exec keycloak /bin/bash -c \
  'echo "KEYCLOAK_LOGLEVEL_CONSOLE=DEBUG" >> /opt/keycloak/bin/standalone.conf'
docker restart keycloak
```

### Test OIDC Discovery
```bash
curl http://localhost:8080/realms/abada-dev/.well-known/openid-configuration
```

## Support & Resources

- [Keycloak Issues](https://github.com/keycloak/keycloak/issues)
- [Keycloak Forum](https://github.com/keycloak/keycloak/discussions)
- [Docker Hub - Keycloak](https://hub.docker.com/r/quay.io/keycloak)
- [OIDC/OAuth2 Specs](https://openid.net/)
