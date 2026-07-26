# Keycloak Realm Configuration Reference

## Realm Settings Overview

### abada-dev Realm Configuration

```json
{
  "realm": "abada-dev",
  "displayName": "Abada Development",
  "enabled": true,
  "sslRequired": "none",
  "accessTokenLifespan": 300,
  "ssoSessionIdleTimeout": 1800,
  "ssoSessionMaxLifespan": 36000,
  "offlineSessionIdleTimeout": 2592000,
  "accessCodeLifespan": 60,
  "accessCodeLifespanUserAction": 300,
  "accessCodeLifespanLogin": 1800,
  "actionTokenGeneratedByAdminLifespan": 43200,
  "actionTokenGeneratedByUserLifespan": 300,
  "offlineSessionMaxLifespanEnabled": false,
  "revokeRefreshToken": false,
  "refreshTokenMaxReuse": 0
}
```

### Security Settings

| Setting | Dev | Prod | Purpose |
|---------|-----|------|---------|
| `sslRequired` | none | external | SSL/TLS enforcement |
| `bruteForceProtected` | false | true | Lock account after failed attempts |
| `permanentLockout` | false | false | Allow unlock via admin |
| `maxFailureWaitSeconds` | 900 | 900 | Wait time after failures |
| `minimumQuickLoginWaitSeconds` | 60 | 60 | Min time before retry |
| `failureFactor` | 30 | 10 | Failed attempts threshold |

### Token Lifespan Configuration

```
┌─────────────────────────────────────┐
│ Access Token (5 min)               │
│ - Used for API calls               │
│ - Short lifespan for security      │
│ - Sent in Authorization header     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Refresh Token (30 min)              │
│ - Used to get new access token     │
│ - Longer lifespan for UX           │
│ - Rotated on use (optional)        │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ SSO Session (30 min idle)           │
│ - Browser session with Keycloak    │
│ - Max 10 hours absolute            │
│ - Remember-me extends timeout      │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Offline Access (30 days)            │
│ - Long-lived refresh tokens        │
│ - For mobile/background apps       │
│ - Requires explicit scope          │
└─────────────────────────────────────┘
```

## Client Configuration

### abada-frontend Client

```json
{
  "clientId": "abada-frontend",
  "name": "Abada Frontend Apps",
  "description": "Frontend application (Tenda/Orun)",
  "enabled": true,
  "publicClient": true,
  "directAccessGrantsEnabled": true,
  "standardFlowEnabled": true,
  "implicitFlowEnabled": true,
  "protocol": "openid-connect",
  "redirectUris": [
    "http://localhost:5602/*",
    "http://localhost:5603/*",
    "https://tenda.example.com/*",
    "https://orun.example.com/*"
  ],
  "webOrigins": [
    "http://localhost:5602",
    "http://localhost:5603",
    "https://tenda.example.com",
    "https://orun.example.com"
  ],
  "access": {
    "view": true,
    "manage": false,
    "manageMembership": false,
    "manageGroupMembership": false,
    "mapRoles": false,
    "impersonate": false,
    "configure": false
  }
}
```

### Client Scopes

**Available Scopes**:
- `openid`: OpenID Connect core scope
- `profile`: User profile information (name, family_name, etc.)
- `email`: User email address
- `address`: User address information
- `phone`: User phone number
- `roles`: User role list (custom mapper)
- `groups`: User group membership (custom mapper)

**Recommended Scope for abada-frontend**:
```
openid profile email roles groups
```

## Role Configuration

### Realm Roles

```json
{
  "roles": {
    "realm": [
      {
        "name": "admin",
        "description": "Administrator with full access",
        "composite": false
      },
      {
        "name": "manager",
        "description": "Manager with view/approve permissions",
        "composite": false
      },
      {
        "name": "user",
        "description": "Standard user with view permissions",
        "composite": false
      },
      {
        "name": "viewer",
        "description": "Read-only access",
        "composite": true,
        "composites": {
          "realm": ["user"]
        }
      }
    ]
  }
}
```

### Client Roles

```json
{
  "clientId": "abada-frontend",
  "roles": [
    {
      "name": "client-admin",
      "description": "Admin access to frontend"
    },
    {
      "name": "client-user",
      "description": "User access to frontend"
    }
  ]
}
```

## Group Configuration

### Group Hierarchy

```
abada-dev/
├── managers (Manager Group)
│   ├── finance-managers
│   ├── operations-managers
│   └── hr-managers
├── customers (Customer Group)
│   ├── vip-customers
│   └── regular-customers
└── developers (Dev Group)
    ├── backend-devs
    └── frontend-devs
```

### Group Attributes

```json
{
  "name": "managers",
  "path": "/managers",
  "attributes": {
    "department": "Management",
    "access-level": "3",
    "cost-center": "100"
  },
  "realmRoles": ["manager"],
  "clientRoles": {
    "abada-frontend": ["client-admin"]
  }
}
```

## User Configuration

### User Profile Mapper

```json
{
  "name": "User Attributes",
  "protocolMapper": "oidc-usermodel-attribute-mapper",
  "protocol": "openid-connect",
  "consentRequired": false,
  "config": {
    "userinfo.token.claim": "true",
    "user.attribute": "department",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "claim.name": "department"
  }
}
```

### Groups Mapper (Realm-Level)

```json
{
  "name": "groups",
  "protocolMapper": "oidc-group-mapper",
  "protocol": "openid-connect",
  "consentRequired": false,
  "config": {
    "full.path": "true",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "claim.name": "groups",
    "userinfo.token.claim": "true"
  }
}
```

### Roles Mapper (Realm-Level)

```json
{
  "name": "realm roles",
  "protocolMapper": "oidc-usermodel-realmrole-mapper",
  "protocol": "openid-connect",
  "consentRequired": false,
  "config": {
    "multivalued": "true",
    "userinfo.token.claim": "true",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "claim.name": "realm_access.roles",
    "jsonType.label": "String"
  }
}
```

## Event Configuration

### Event Types to Monitor

```json
{
  "eventsEnabled": true,
  "eventsListeners": ["jboss-logging"],
  "enabledEventTypes": [
    "LOGIN",
    "LOGOUT",
    "LOGIN_ERROR",
    "CLIENT_LOGIN",
    "CLIENT_LOGIN_ERROR",
    "UPDATE_PASSWORD",
    "UPDATE_TOTP",
    "UPDATE_PROFILE_ERROR",
    "CREATE_USER",
    "DELETE_USER",
    "UPDATE_USER",
    "REGISTER"
  ],
  "adminEventsEnabled": true,
  "adminEventsDetailsEnabled": true
}
```

### Event Storage

- **Default**: Database (H2/PostgreSQL)
- **Alternative**: External event listeners (Webhook, Kafka, etc.)

## Theme Customization

### Theme Files Location
```
keycloak/themes/
├── abada/
│   ├── admin/
│   ├── login/
│   │   ├── theme.properties
│   │   ├── login.ftl
│   │   └── styles/
│   ├── account/
│   └── email/
```

### Custom Login Theme Example

```properties
# theme.properties
parent=base
import=common/keycloak

styles=lib/bootstrap/dist/css/bootstrap.min.css \
  css/login.css \
  css/custom.css

scripts=lib/jquery/jquery.min.js \
  js/custom.js
```

## Performance Tuning

### Database Query Optimization

```sql
-- Add indexes for common queries
CREATE INDEX idx_user_realm_id ON user_entity(realm_id);
CREATE INDEX idx_group_realm_id ON keycloak_group(realm_id);
CREATE INDEX idx_role_realm_id ON keycloak_role(realm_id);
CREATE INDEX idx_user_attribute_name ON user_attribute(name);
```

### Cache Configuration

```
Infinispan caches:
- realms: Realm metadata (1000 entries, 12h TTL)
- users: User objects (10000 entries, 30m TTL)
- authz: Authorization data (1000 entries, 24h TTL)
- sessions: HTTP sessions (10000 entries, 1h TTL)
```

## Migration from v19 to v21

### Breaking Changes
- Java 11 minimum → Java 17 required
- WildFly removal → Quarkus framework
- Removed features: Deprecated protocols, legacy adapters

### Migration Steps
1. Export realm from v19
2. Test import on v21 in dev environment
3. Verify token format and claims
4. Update client configurations
5. Test with frontend applications
6. Schedule maintenance window for production cutover

## References

- [Keycloak Server Admin Guide](https://www.keycloak.org/server-admin-guide/)
- [Keycloak Client Protocols](https://www.keycloak.org/server-admin-guide/latest/index.html#supported-protocols)
- [OpenID Connect Specification](https://openid.net/specs/openid-connect-core-1_0.html)
- [SAML Specification](https://docs.oasis-open.org/security/saml/)
