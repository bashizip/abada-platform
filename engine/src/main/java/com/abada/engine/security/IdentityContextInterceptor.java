package com.abada.engine.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.servlet.HandlerInterceptor;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.project.PrincipalService;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

/**
 * A Spring Web MVC interceptor that extracts user identity information from
 * request headers and stores it in the {@link IdentityContext}.
 * It ensures the context is cleared after the request is completed.
 */
@Component
public class IdentityContextInterceptor implements HandlerInterceptor {

    private final String securityMode;
    private final PrincipalService principals;

    public IdentityContextInterceptor(@Value("${abada.security.mode:disabled}") String securityMode,
            PrincipalService principals) {
        this.securityMode = securityMode;
        this.principals = principals;
    }

    // OAuth2 Proxy headers (from oauth2-proxy ForwardAuth)
    private static final String OAUTH2_USER_HEADER = "X-Auth-Request-User";
    private static final String OAUTH2_GROUPS_HEADER = "X-Auth-Request-Groups";
    private static final String OAUTH2_EMAIL_HEADER = "X-Auth-Request-Email";

    // Legacy headers (for backward compatibility and direct header injection)
    private static final String USER_HEADER = "X-User";
    private static final String GROUPS_HEADER = "X-Groups";

    @Override
    public boolean preHandle(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
            @NonNull Object handler) {
        String username;
        String issuer;
        String subject;
        PrincipalEntity.Type principalType = PrincipalEntity.Type.HUMAN;
        List<String> groups;
        if ("oidc".equalsIgnoreCase(securityMode)) {
            var authentication = SecurityContextHolder.getContext().getAuthentication();
            if (authentication instanceof JwtAuthenticationToken jwt && authentication.isAuthenticated()) {
                String preferredUsername = jwt.getToken().getClaimAsString("preferred_username");
                username = preferredUsername == null || preferredUsername.isBlank()
                        ? authentication.getName() : preferredUsername;
                issuer = jwt.getToken().getIssuer() == null ? "oidc" : jwt.getToken().getIssuer().toString();
                subject = jwt.getToken().getSubject();
                if (subject == null || subject.isBlank()) subject = authentication.getName();
                if (username.startsWith("service-account-") || jwt.getToken().hasClaim("client_id")) {
                    principalType = PrincipalEntity.Type.SERVICE;
                }
                List<String> claimedGroups = jwt.getToken().getClaimAsStringList("groups");
                groups = claimedGroups == null ? List.of() : List.copyOf(claimedGroups);
            } else {
                username = "anonymous";
                issuer = "oidc";
                subject = "anonymous";
                groups = List.of();
            }
        } else if ("proxy".equalsIgnoreCase(securityMode)) {
            username = Optional.ofNullable(request.getHeader(OAUTH2_USER_HEADER))
                    .or(() -> Optional.ofNullable(request.getHeader(OAUTH2_EMAIL_HEADER)))
                    .orElse("anonymous");
            issuer = "trusted-proxy";
            subject = username.toLowerCase(java.util.Locale.ROOT);
            groups = splitHeader(request.getHeader(OAUTH2_GROUPS_HEADER));
        } else {
            username = Optional.ofNullable(request.getHeader(USER_HEADER)).orElse("anonymous");
            issuer = "local-disabled";
            subject = username.toLowerCase(java.util.Locale.ROOT);
            groups = splitHeader(request.getHeader(GROUPS_HEADER));
        }

        PrincipalEntity principal = principals.observe(issuer, subject, username, principalType);
        IdentityContext.set(new Identity(principal.getId(), username, groups));
        return true;
    }

    private List<String> splitHeader(String value) {
        if (value == null) return Collections.emptyList();
        return Arrays.stream(value.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    @Override
    public void afterCompletion(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
            @NonNull Object handler, Exception ex) {
        IdentityContext.clear();
    }
}
