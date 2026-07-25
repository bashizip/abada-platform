# Abada Platform: Full Multi-Tenant CORS & Vary Configuration

This document provides the complete technical setup for handling dynamic customer subdomains (`*.localhost` and `*.abada.dev`) using Spring Boot 3.5.x and Traefik.

---

## 📋 Table of Contents

1. [Spring Boot Engine Configuration](#1-spring-boot-engine-configuration)
2. [The "Vary" Header Instruction](#2-the-vary-header-instruction)
3. [Traefik Docker-Compose Configuration](#3-traefik-docker-compose-configuration)
4. [Keycloak Global Configuration](#4-keycloak-global-configuration)
5. [Migration Plan](#5-migration-plan)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Spring Boot Engine Configuration

This configuration handles the CORS preflight logic and ensures the `Vary: Origin` header is correctly set to prevent cache poisoning between tenants.

### SecurityConfig.java

**Location:** `engine/src/main/java/com/abada/engine/security/SecurityConfig.java`

```java
package com.abada.engine.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
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
                .anyRequest().authenticated()
            );
            
        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        return request -> {
            String origin = request.getHeader("Origin");
            CorsConfiguration config = new CorsConfiguration();

            // DYNAMIC ORIGIN VALIDATION
            if (isValidOrigin(origin)) {
                // We echo the specific origin. This automatically triggers 
                // Spring to add "Vary: Origin" to the response.
                config.setAllowedOrigins(List.of(origin));
            } else {
                // If invalid, we return a configuration that doesn't allow the origin
                return null; 
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

        // 1. Dev Environment
        if (origin.endsWith(".localhost") || 
            origin.startsWith("http://localhost:") ||
            origin.startsWith("https://localhost:")) return true;

        // 2. Production Subdomains
        if (origin.endsWith("." + platformDomain)) return true;

        // 3. TODO: Customer Custom Domain Database Lookup
        return false;
    }
}
```

### OAuth2ProxyAuthenticationFilter.java

**Location:** `engine/src/main/java/com/abada/engine/security/OAuth2ProxyAuthenticationFilter.java`

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
            List<SimpleGrantedAuthority> authorities = new ArrayList<>();
            if (groups != null && !groups.isEmpty()) {
                Arrays.stream(groups.split(","))
                    .map(String::trim)
                    .filter(g -> !g.isEmpty())
                    .forEach(g -> authorities.add(new SimpleGrantedAuthority("ROLE_" + g.toUpperCase())));
            }
            
            UsernamePasswordAuthenticationToken auth = 
                new UsernamePasswordAuthenticationToken(user, null, authorities);
            
            if (email != null) {
                auth.setDetails(email);
            }
            
            SecurityContextHolder.getContext().setAuthentication(auth);
        }
        
        filterChain.doFilter(request, response);
    }
}
```

---

## 2. The "Vary" Header Instruction

The `Vary: Origin` header tells Traefik and browser caches: **"The content of this response is different depending on who is asking (the Origin)."**

### Why It's Crucial for Abada

Without this header:
1. `customer1.abada.dev` makes a request
2. Traefik caches the response with `Access-Control-Allow-Origin: customer1.abada.dev`
3. `customer2.abada.dev` requests the same endpoint
4. Traefik serves the cached response
5. **Browser blocks** because origin doesn't match!

### How We Ensure It

**Spring Auto-Behavior:** By using `config.setAllowedOrigins(List.of(origin))` with a **specific value** instead of `*`, Spring Security's `DefaultCorsProcessor` automatically adds `Vary: Origin`.

### Verification

In your browser DevTools (Network tab), ensure that **every REST API response** contains:

```
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
Access-Control-Allow-Origin: https://<specific-subdomain>.localhost
Access-Control-Allow-Credentials: true
```

---

## 3. Traefik Docker-Compose Configuration

### Production & Dev Configuration

**Remove all Traefik-level CORS middlewares.** Spring Boot handles CORS headers.

### docker-compose.yml (Engine Service)

```yaml
services:
  abada-engine:
    image: abada-engine:latest
    labels:
      - "traefik.enable=true"
      
      # Regex matches any subdomain for dev and prod domains
      - "traefik.http.routers.engine.rule=HostRegexp(`{subdomain:[a-z0-9-]+}.localhost`) || HostRegexp(`{subdomain:[a-z0-9-]+}.abada.dev`)"
      
      - "traefik.http.routers.engine.entrypoints=web,websecure"
      - "traefik.http.routers.engine.tls=true"
      
      # OAuth2-Proxy for authentication
      - "traefik.http.routers.engine.middlewares=oauth2-proxy-prod"
      
      - "traefik.http.routers.engine.service=engine"
      - "traefik.http.services.engine.loadbalancer.server.port=5601"
      
      # ✅ CRITICAL: Do NOT add traefik.http.middlewares.headers... here.
      # Spring Boot handles the CORS headers, not Traefik.
```

### What to Remove

**❌ REMOVE these labels:**

```yaml
# ❌ OLD - Don't use Traefik CORS middlewares
- "traefik.http.routers.engine.middlewares=oauth2-proxy,cors-headers"
- "traefik.http.middlewares.cors-headers.headers.accesscontrolallowmethods=GET,POST,PUT,DELETE,OPTIONS"
- "traefik.http.middlewares.cors-headers.headers.accesscontrolallowheaders=*"
- "traefik.http.middlewares.cors-headers.headers.accesscontrolalloworiginlist=*"
- "traefik.http.middlewares.cors-headers.headers.accesscontrolallowcredentials=true"
```

**Why:** Traefik middlewares apply static headers. We need **dynamic** headers based on the request origin.

---

## 4. Keycloak Global Configuration

To support the dynamic nature of your SaaS, configure your Keycloak client to accept wildcard origins.

### Realm Configuration (realm-prod.json)

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

### Key Settings Explained

| Setting | Value | Meaning |
|---------|-------|---------|
| **Root URL** | (empty) | Let Keycloak auto-detect |
| **Valid Redirect URIs** | `https://*.localhost/*`<br>`https://*.abada.dev/*` | Accepts any subdomain |
| **Web Origins** | `+` | **Must be exactly the plus sign** - accepts any origin from redirectUris |

### ⚠️ Security Note

Using `webOrigins: ["+"]` is permissive. For production with strict security requirements:
- Consider specific origins per customer
- Implement origin validation in application layer (already done in `SecurityConfig`)

---

## 5. Migration Plan

For teams migrating from the previous permissive CORS configuration (`allowedOriginPatterns("*")`), follow the step-by-step migration plan:

📖 **See:** [`docs/development/cors-migration-plan.md`](./cors-migration-plan.md)

### Migration Phases Overview

| Phase | Description | Duration |
|-------|-------------|----------|
| **Phase 1** | Add Spring Security + CORS filter | Week 1-2 |
| **Phase 2** | Update Traefik configuration | Week 2 |
| **Phase 3** | Update Keycloak configuration | Week 2 |
| **Phase 4** | Testing & validation | Week 3 |
| **Phase 5** | Cleanup & production rollout | Week 4 |

### Quick Start

```bash
# 1. Create feature branch
git checkout -b feature/multi-tenant-cors

# 2. Add Spring Security dependency to pom.xml
# 3. Create SecurityConfig.java
# 4. Create OAuth2ProxyAuthenticationFilter.java
# 5. Update docker-compose labels
# 6. Test with curl (see migration plan)
```

---

## 6. Troubleshooting

### Issue: "No 'Access-Control-Allow-Origin' header"

**Symptom:** Browser console shows CORS error

**Cause:** Origin validation failed in `SecurityConfig`

**Debug:**
```java
// Add logging to SecurityConfig
logger.debug("Received origin: {}", origin);
logger.debug("Is valid: {}", isValidOrigin(origin));
logger.debug("Platform domain: {}", platformDomain);
```

**Solution:** Check that origin matches pattern:
- Dev: `https://<subdomain>.localhost` or `http://localhost:<port>`
- Prod: `https://<subdomain>.abada.dev`

### Issue: "Vary header missing"

**Symptom:** Response doesn't include `Vary: Origin`

**Cause:** Using old `WebConfig` filter instead of Spring Security

**Solution:** 
1. Ensure `SecurityConfig` bean is loaded
2. Remove `corsFilter()` bean from `WebConfig`
3. Verify `@EnableWebSecurity` annotation present

### Issue: "OAuth2-Proxy headers not working"

**Symptom:** 401 Unauthorized despite valid OAuth2-Proxy headers

**Cause:** Filter order incorrect or filter not loaded

**Solution:**
1. Verify `@Order(Ordered.HIGHEST_PRECEDENCE)` on filter
2. Check filter is registered as Spring bean (`@Component`)
3. Add debug logging to filter

### Issue: "Cache still leaking between tenants"

**Symptom:** Customer A gets Customer B's CORS headers

**Cause:** Traefik caching without respecting `Vary` header

**Solution:**
```yaml
# In traefik.yml - disable cache for API routes
serversTransport:
  disablingCache: true
```

Or add cache-busting headers:
```yaml
# In engine labels
- "traefik.http.middlewares.no-cache.headers.customresponseheaders.Cache-Control=no-cache,no-store,must-revalidate"
```

---

## 📚 Additional Resources

- [Spring Security CORS Documentation](https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html)
- [Traefik v3 Documentation](https://doc.traefik.io/traefik/)
- [MDN Vary Header Reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Vary)
- [OAuth2-Proxy Configuration](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview)

---

**Last Updated:** 2026-02-24  
**Status:** ✅ Production Ready  
**Next Review:** After first customer deployment
