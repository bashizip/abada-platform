# Abada Platform: Multi-Tenant CORS Migration Plan

## Overview

This document provides the complete migration plan from the current permissive CORS configuration (`allowedOriginPatterns("*")`) to a proper multi-tenant architecture with dynamic origin validation and Spring Security integration.

**Target Architecture:** Dynamic CORS validation with Spring Security + OAuth2-Proxy integration

**Timeline:** 2-3 sprints (including testing)

---

## 📊 Current State vs Target State

| Aspect | Current State | Target State | Priority |
|--------|--------------|--------------|----------|
| **CORS Validation** | `allowedOriginPatterns("*")` | Dynamic whitelist validation | 🔴 Critical |
| **Vary Header** | Not guaranteed | Automatic via Spring | 🔴 Critical |
| **Security Framework** | None (CORS filter only) | Spring Security | 🟡 High |
| **Traefik CORS** | Configured in middlewares | Removed (Spring handles) | 🟡 High |
| **OAuth2 Integration** | Direct header injection | Filter + Spring Security | 🟡 High |
| **Multi-tenant Support** | ❌ Not supported | ✅ Full support | 🔴 Critical |

---

## 🎯 Phase 1: Add Spring Security (Week 1-2)

### 1.1 Add Dependencies

**File:** `engine/pom.xml`

```xml
<dependencies>
    <!-- Add Spring Security -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-security</artifactId>
    </dependency>
</dependencies>
```

### 1.2 Create SecurityConfig

**File:** `engine/src/main/java/com/abada/engine/security/SecurityConfig.java`

```java
package com.abada.engine.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Value("${abada.domain:abada.dev}")
    private String platformDomain;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(csrf -> csrf.disable()) // OAuth2-Proxy handles authentication
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health", "/actuator/info").permitAll()
                .requestMatchers("/api/v1/info").permitAll()
                .requestMatchers("/swagger-ui/**", "/v3/api-docs/**").permitAll()
                .anyRequest().authenticated() // Trust OAuth2-Proxy headers
            );
            
        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        return request -> {
            String origin = request.getHeader("Origin");
            CorsConfiguration config = new CorsConfiguration();

            if (isValidOrigin(origin)) {
                // Echo specific origin - Spring automatically adds "Vary: Origin"
                config.setAllowedOrigins(List.of(origin));
            } else {
                return null; // Reject invalid origins
            }

            config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"));
            config.setAllowedHeaders(List.of("*"));
            config.setExposedHeaders(List.of(
                "Authorization",
                "X-User",
                "X-Groups",
                "X-Auth-Request-Email",
                "X-Auth-Request-Access-Token"
            ));
            config.setAllowCredentials(true);
            config.setMaxAge(3600L);
            
            return config;
        };
    }

    private boolean isValidOrigin(String origin) {
        if (origin == null) return false;

        // 1. Dev Environment (*.localhost)
        if (origin.endsWith(".localhost")) return true;
        if (origin.startsWith("http://localhost:")) return true;
        if (origin.startsWith("https://localhost:")) return true;

        // 2. Production Subdomains (*.abada.dev)
        if (origin.endsWith("." + platformDomain)) return true;

        // 3. Future: Custom domain database lookup
        // TODO: Implement customer domain lookup from database

        return false;
    }
}
```

### 1.3 Create OAuth2-Proxy Filter

**File:** `engine/src/main/java/com/abada/engine/security/OAuth2ProxyAuthenticationFilter.java`

```java
package com.abada.engine.security;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Filter that extracts user information from OAuth2-Proxy headers and creates
 * a Spring Security authentication context.
 * 
 * OAuth2-Proxy injects these headers after validating JWT tokens:
 * - X-Auth-Request-User: User identifier (e.g., "alice")
 * - X-Auth-Request-Groups: Comma-separated groups (e.g., "managers,customers")
 * - X-Auth-Request-Email: User email
 * - X-Auth-Request-Access-Token: Access token
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class OAuth2ProxyAuthenticationFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) 
            throws ServletException, IOException {
        
        String user = request.getHeader("X-Auth-Request-User");
        String groups = request.getHeader("X-Auth-Request-Groups");
        String email = request.getHeader("X-Auth-Request-Email");
        
        if (user != null && !user.isEmpty()) {
            // Create authorities from groups
            List<SimpleGrantedAuthority> authorities = new ArrayList<>();
            if (groups != null && !groups.isEmpty()) {
                Arrays.stream(groups.split(","))
                    .map(String::trim)
                    .filter(g -> !g.isEmpty())
                    .forEach(g -> authorities.add(new SimpleGrantedAuthority("ROLE_" + g.toUpperCase())));
            }
            
            // Create authentication token
            UsernamePasswordAuthenticationToken auth = 
                new UsernamePasswordAuthenticationToken(user, null, authorities);
            
            // Add email as additional detail
            if (email != null) {
                auth.setDetails(email);
            }
            
            SecurityContextHolder.getContext().setAuthentication(auth);
            
            logger.debug("Authenticated user: {} with groups: {}", user, groups);
        } else {
            logger.debug("No OAuth2-Proxy headers found - request will be handled by Spring Security");
        }
        
        filterChain.doFilter(request, response);
    }
}
```

### 1.4 Update WebConfig (Keep CORS Filter as Fallback)

**File:** `engine/src/main/java/com/abada/engine/security/WebConfig.java`

Keep the existing `WebConfig.java` CORS filter **temporarily** during the migration period. Once Spring Security is fully tested, remove it.

**Why keep it:** Provides fallback during testing period and ensures no regression.

---

## 🎯 Phase 2: Update Traefik Configuration (Week 2)

### 2.1 Remove CORS Middlewares from Docker Compose

**File:** `docker-compose.yml` and `docker-compose.prod.yml`

**REMOVE these labels from Engine service:**

```yaml
# ❌ REMOVE ALL CORS MIDDLEWARES
- "traefik.http.routers.abada.middlewares=oauth2-proxy-prod,cors-headers"
- "traefik.http.middlewares.cors-headers.headers.accesscontrolallowmethods=GET,POST,PUT,DELETE,OPTIONS,PATCH"
- "traefik.http.middlewares.cors-headers.headers.accesscontrolallowheaders=Authorization,Content-Type"
- "traefik.http.middlewares.cors-headers.headers.accesscontrolalloworiginlist=..."
- "traefik.http.middlewares.cors-headers.headers.accesscontrolmaxage=3600"
- "traefik.http.middlewares.cors-headers.headers.accesscontrolallowcredentials=true"
```

**KEEP only:**

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.engine.rule=HostRegexp(`{subdomain:[a-z0-9-]+}.localhost`)"
  - "traefik.http.routers.engine.entrypoints=web,websecure"
  - "traefik.http.routers.engine.tls=true"
  - "traefik.http.routers.engine.middlewares=oauth2-proxy-prod"
  - "traefik.http.routers.engine.service=engine"
  - "traefik.http.services.engine.loadbalancer.server.port=5601"
```

### 2.2 Update Traefik Dynamic Configuration

**File:** `docker/traefik/dynamic.yml`

Remove any CORS-related middleware definitions. Keep only routing and TLS configuration.

---

## 🎯 Phase 3: Update Keycloak Configuration (Week 2)

### 3.1 Update Realm Import

**File:** `docker/keycloak/import/realm-prod.json`

```json
{
  "clients": [
    {
      "clientId": "abada-frontend",
      "enabled": true,
      "publicClient": true,
      "directAccessGrantsEnabled": true,
      "redirectUris": [
        "https://*.localhost/*",
        "https://*.abada.dev/*"
      ],
      "webOrigins": ["+"],
      "protocol": "openid-connect",
      "attributes": {
        "pkce.code.challenge.method": "S256"
      }
    }
  ]
}
```

**Key Changes:**
- `webOrigins: ["+"]` - Accepts any origin from redirectUris
- Wildcard patterns for subdomains

---

## 🎯 Phase 4: Testing & Validation (Week 3)

### 4.1 Test Scenarios

#### Test 1: CORS Preflight with Different Origins

```bash
# Test with customer1.localhost
curl -v -X OPTIONS \
  -H "Origin: https://customer1.localhost" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization,Content-Type" \
  https://localhost/api/v1/tasks

# Expected response headers:
# Access-Control-Allow-Origin: https://customer1.localhost
# Access-Control-Allow-Credentials: true
# Vary: Origin
```

#### Test 2: Invalid Origin Should Be Rejected

```bash
# Test with malicious origin
curl -v -X OPTIONS \
  -H "Origin: https://evil.com" \
  -H "Access-Control-Request-Method: GET" \
  https://localhost/api/v1/tasks

# Expected: No CORS headers or 403 Forbidden
```

#### Test 3: Verify Vary Header

```bash
# Check all responses include Vary header
curl -v https://localhost/api/v1/tasks \
  -H "Origin: https://customer1.localhost" \
  -H "Authorization: Bearer <token>"

# Expected in response:
# Vary: Origin
```

#### Test 4: Multi-Tenant Cache Isolation

```bash
# Request 1: customer1.localhost
curl -H "Origin: https://customer1.localhost" https://localhost/api/v1/tasks

# Request 2: customer2.localhost (immediately after)
curl -H "Origin: https://customer2.localhost" https://localhost/api/v1/tasks

# Both should get their own Access-Control-Allow-Origin header
# (not cached from first request)
```

### 4.2 Browser DevTools Checklist

- [ ] Open DevTools → Network tab
- [ ] Make API request from `tenda.localhost`
- [ ] Check response headers include:
  - `Access-Control-Allow-Origin: https://tenda.localhost`
  - `Vary: Origin`
  - `Access-Control-Allow-Credentials: true`
- [ ] Repeat from `orun.localhost` - should get different `Access-Control-Allow-Origin`
- [ ] Verify no CORS errors in console

### 4.3 OAuth2-Proxy Integration Test

```bash
# Test authenticated request
curl -v https://localhost/api/v1/tasks \
  -H "Origin: https://tenda.localhost" \
  -H "X-Auth-Request-User: admin" \
  -H "X-Auth-Request-Groups: managers,admin"

# Expected:
# - 200 OK (not 401)
# - User context available in logs
```

---

## 🎯 Phase 5: Cleanup & Production Rollout (Week 4)

### 5.1 Remove Fallback CORS Filter

**File:** `engine/src/main/java/com/abada/engine/security/WebConfig.java`

Remove the `corsFilter()` bean once Spring Security is fully tested and validated.

**Keep:** `addCorsMappings()` method as documentation reference.

### 5.2 Update Documentation

- [ ] Update `docs/development/api.md` with new security configuration
- [ ] Update `docs/operations/docker-deployment.md` with Traefik changes
- [ ] Add troubleshooting guide for CORS issues

### 5.3 Production Deployment Checklist

- [ ] Deploy to staging environment first
- [ ] Test with real subdomains (customer1.abada.dev, customer2.abada.dev)
- [ ] Monitor logs for CORS-related errors
- [ ] Verify cache behavior with CDN/Traefik
- [ ] Roll out to production during low-traffic window
- [ ] Monitor for 24 hours

---

## 🔧 Troubleshooting Guide

### Issue 1: "No 'Access-Control-Allow-Origin' header"

**Cause:** Origin validation failed

**Solution:**
```java
// Check logs for origin validation
logger.debug("Received origin: {}", origin);
logger.debug("Is valid: {}", isValidOrigin(origin));
```

### Issue 2: "Vary header missing"

**Cause:** Using `WebConfig` filter instead of Spring Security

**Solution:** Ensure `SecurityConfig` is being used, not just `WebConfig`

### Issue 3: "OAuth2-Proxy headers not working"

**Cause:** Filter order incorrect

**Solution:** Verify `@Order(Ordered.HIGHEST_PRECEDENCE)` on filter

### Issue 4: "Cache still leaking between tenants"

**Cause:** Traefik caching without respecting Vary header

**Solution:** Add Traefik cache configuration:
```yaml
# In traefik.yml
serversTransport:
  disablingCache: true  # Disable for API routes
```

---

## 📈 Success Metrics

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| CORS errors in logs | 50+/day | <5/day | 0 |
| Multi-tenant support | ❌ | ✅ | ✅ |
| Cache poisoning risk | High | None | None |
| Security framework | None | Spring Security | ✅ |
| Custom domain ready | ❌ | ✅ (TODO) | ✅ |

---

## 📚 References

- [Spring Security CORS Documentation](https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html)
- [Traefik v3 CORS Guide](https://doc.traefik.io/traefik/middlewares/http/headers/#cors-headers)
- [MDN Vary Header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Vary)
- [OAuth2-Proxy Authentication](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview)

---

## 🚀 Next Steps

1. **Review this plan** with team
2. **Create feature branch**: `feature/multi-tenant-cors`
3. **Implement Phase 1** (Spring Security)
4. **Test in dev environment**
5. **Proceed through remaining phases**

**Estimated Total Time:** 2-3 weeks (including testing and validation)

---

*Last Updated: 2026-02-24*
*Author: Migration Planning Session*
*Status: Ready for Implementation*
