# Keycloak Architecture & Design Decisions

## Design Philosophy

The Keycloak integration follows a **gateway-based authentication** pattern:

1. **Auth-Agnostic Engine**: The abada-engine does not implement authentication logic
2. **Centralized Identity**: Keycloak provides single source of truth for users/groups
3. **Gateway Validation**: Traefik validates JWT tokens and injects identity headers
4. **Header-Based Context**: Engine consumes pre-validated identity from request headers

## Architecture Diagram

```
┌─────────────┐
│  Frontend   │
│ (Tenda/    │
│  Orun)     │
└──────┬──────┘
       │ OIDC/OAuth2
       ↓
   ┌─────────────────┐
   │    Keycloak     │
   │ (Identity Mgmt) │
   └────────┬────────┘
            │ JWT Token
            ↓
┌──────────────────────────┐
│      Traefik Gateway     │
│ - Validates JWT          │
│ - Injects X-User header  │
│ - Injects X-Groups header│
└──────────┬───────────────┘
           │ HTTP + Headers
           ↓
    ┌────────────────┐
    │ Abada Engine   │
    │ (Processes,   │
    │  Tasks, etc.) │
    └────────────────┘
```

## Key Components

### Keycloak
- **Container**: `quay.io/keycloak/keycloak:21.1.1`
- **Database**: PostgreSQL 15 (`keycloak-db`)
- **Default Realm**: `abada-dev`
- **Admin Console**: http://localhost:8080

### Test Users & Groups
- Users: alice (group: managers), bob (group: customers)
- Groups: managers, customers (map to BPMN candidateGroups)

### Traefik Middleware
- Validates JWT signature
- Extracts user identity from token claims
- Injects `X-User` (preferred_username) and `X-Groups` headers
- Allows engine to make authorization decisions based on group membership

## Security Considerations

### Development Environment
- HTTPS disabled (`sslRequired: none`)
- Default credentials used (`admin/admin`)
- HTTP proxy mode enabled (`KC_PROXY=edge`)
- Realm import from JSON file

### Production Environment Checklist
- [ ] Enable HTTPS (`sslRequired: external`)
- [ ] Use environment-based secrets for admin credentials
- [ ] Pin Keycloak and PostgreSQL image versions
- [ ] Configure vault/secrets manager integration
- [ ] Enable audit logging and event monitoring
- [ ] Use certificate-based database connections
- [ ] Implement Traefik JWT middleware properly
- [ ] Configure realm backup/restore procedures
- [ ] Set up database replication/HA
- [ ] Enable TLS for all inter-service communication

## Token Flow Details

### Authorization Code Flow (OAuth2/OIDC)
```
Frontend → Keycloak /authorize
Keycloak → Redirect back with code
Frontend → /token endpoint with code
Keycloak → Returns JWT + Refresh Token
Frontend → Send Bearer Token in requests
Traefik → Validate JWT, extract claims, inject headers
Engine → Consume X-User/X-Groups headers
```

### Claims Mapping
- `preferred_username` → `X-User` header
- `groups` claim → `X-Groups` header (comma-separated)
- `email` → Optional, for audit trails
- `sub` (subject) → Unique user ID, alternative to username

## Configuration Options

### Environment Variables
```bash
KEYCLOAK_ADMIN_USERNAME=admin              # Admin account username
KEYCLOAK_ADMIN_PASSWORD=admin              # Admin account password
KEYCLOAK_DB_PASSWORD=keycloak_dev_pw       # PostgreSQL password
KC_PROXY=edge                              # Proxy configuration
KC_PROXY_HEADERS=xforwarded                # Accept X-Forwarded-* headers
KEYCLOAK_IMPORT=/path/to/realm.json        # Initial realm import
```

### Realm Settings
- `sslRequired`: none (dev), external (prod)
- `refreshTokenMaxReuse`: 0 (disable reuse)
- `accessTokenLifespan`: 300 seconds
- `ssoSessionIdleTimeout`: 1800 seconds

## Future Enhancements

1. **User Federation**: Connect to LDAP/AD for enterprise integration
2. **Social Login**: Add Google, GitHub, Microsoft providers
3. **Multi-Factor Authentication**: TOTP/WebAuthn support
4. **Custom Themes**: Branding and customization
5. **Event Hooks**: Integrate with external audit systems
6. **Scripting**: Custom validation and claim mapping
7. **Performance**: Caching layer (Redis) for tokens
8. **Monitoring**: Prometheus metrics export

## References

- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [OpenID Connect Specification](https://openid.net/connect/)
- [OAuth 2.0 RFC 6749](https://tools.ietf.org/html/rfc6749)
- [Traefik JWT Middleware](https://doc.traefik.io/traefik/middlewares/http/forwardauth/)
- [BPMN User Task Assignment](https://camunda.com/bpmn/user-task/)
