# Keycloak Integration Testing Guide

## Automated Verification Checklist

### 1. Realm Import Verification
```bash
# Check realm exists
curl -s http://localhost:8080/realms/abada-dev | grep realm

# Expected: "realm":"abada-dev"
```

### 2. User and Group Verification
```bash
# Get admin token
TOKEN=$(curl -s -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=admin-cli&username=admin&password=admin&grant_type=password" | jq -r '.access_token')

# Verify users exist
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/admin/realms/abada-dev/users | jq '.[].username'

# Expected: alice, bob
```

### 3. Token Generation Test
```bash
# Test alice user token
curl -s -X POST http://localhost:8080/realms/abada-dev/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=abada-frontend&username=alice&password=alice&grant_type=password" | jq '.token_type'

# Expected: "Bearer"
```

### 4. Engine Header Injection Test
```bash
# Test engine accepts identity headers
curl -s -H "X-User: alice" -H "X-Groups: managers" \
  http://localhost:5601/abada/api/v1/processes | head -c 100

# Expected: JSON array response (not 401/403)
```

### 5. BPMN Task Assignment Test
```bash
# Verify engine understands group-based task assignment
# This requires a running BPMN process with candidateGroups="managers"

curl -s -H "X-User: alice" -H "X-Groups: managers" \
  http://localhost:5601/abada/api/v1/tasks | jq '.[] | select(.assigneeGroups[] | contains("managers"))'
```

## Manual Testing Steps

1. **Start all services**:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
   ```

2. **Access Keycloak Admin Console**:
   - Navigate to http://localhost:8080
   - Login with admin/admin
   - Verify realm `abada-dev` exists
   - Check users alice/bob are present
   - Verify groups managers/customers exist

3. **Generate Token and Copy**:
   - Execute token generation command above
   - Copy the full access_token value

4. **Test Engine API**:
   - Use token or headers to call engine endpoints
   - Verify appropriate response codes and data

## Known Issues & Resolutions

### Issue: HTTPS Required
**Solution**: Realm has `sslRequired: none` for dev mode. In production, set to `external` or `all`.

### Issue: Token Endpoint Returns 401
**Solution**: Ensure `KC_PROXY=edge` and `KC_PROXY_HEADERS=xforwarded` are set.

### Issue: Engine Returns 403 for Group Task
**Solution**: Verify X-Groups header includes the candidateGroup value exactly.

## Performance Testing

### Load Test with Multiple Users
```bash
for i in {1..10}; do
  curl -s -H "X-User: user$i" -H "X-Groups: group$i" \
    http://localhost:5601/abada/api/v1/processes > /dev/null &
done
wait
```

### Monitor Resource Usage
```bash
docker stats keycloak keycloak-db abada-engine
```

## Cleanup

To reset Keycloak database and realm:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
rm -rf docker/keycloak/data/*
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d keycloak-db keycloak
```
