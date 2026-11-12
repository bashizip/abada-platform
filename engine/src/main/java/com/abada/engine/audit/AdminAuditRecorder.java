package com.abada.engine.audit;

import com.abada.engine.audit.AdminAuditEventEntity.Outcome;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opentelemetry.api.trace.Span;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Writes the administration audit trail (S10).
 *
 * <ul>
 *   <li>{@link #recordSuccess} joins the caller's transaction and refuses to run
 *       without one: the event commits with the change it describes, and a change
 *       that rolls back leaves no {@code SUCCESS} event.</li>
 *   <li>{@link #recordExternalSuccess} is for changes the database does not hold
 *       (users and groups live in the identity provider): written in its own
 *       transaction once the provider has accepted the change.</li>
 *   <li>{@link #recordDenied} is written in its own transaction for a refused call;
 *       it never fails the response it describes.</li>
 * </ul>
 *
 * The actor, roles, trace and client address come from the current request; the
 * caller passes only the action, the target and non-sensitive details.
 */
@Component
public class AdminAuditRecorder {
    private static final Logger log = LoggerFactory.getLogger(AdminAuditRecorder.class);
    static final int MAX_DETAILS_CHARS = 16_000;

    @PersistenceContext
    private EntityManager entityManager;

    private final ObjectMapper objectMapper;

    public AdminAuditRecorder(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void recordSuccess(String action, String targetType, String targetId, String projectId,
            AdminAuditDetails details) {
        persist(action, targetType, targetId, projectId, Outcome.SUCCESS, details);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordExternalSuccess(String action, String targetType, String targetId,
            AdminAuditDetails details) {
        persist(action, targetType, targetId, null, Outcome.SUCCESS, details);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordDenied(AdminAuditActions.Classified call, String reason) {
        persist(call.action(), call.targetType(), call.targetId(), call.projectId(), Outcome.DENIED,
                AdminAuditDetails.create().put("reason", reason));
    }

    /** Records a refused administrative call, if {@code request} is one. Never throws. */
    public void deniedIfAdministrative(HttpServletRequest request, String reason) {
        try {
            AdminAuditActions.classify(request).ifPresent(call -> self().recordDenied(call, reason));
        } catch (RuntimeException exception) {
            log.warn("Could not record a denied administrative call: {}", exception.getClass().getSimpleName());
        }
    }

    /**
     * Records the current request as a refused administrative call, if it is one. For
     * refusals that do not surface as a 403, such as a project role check that answers
     * 404 so that outsiders cannot tell the project exists. Never throws.
     */
    public void deniedCurrentRequest(String reason) {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            deniedIfAdministrative(attributes.getRequest(), reason);
        }
    }

    private AdminAuditRecorder self;

    /** Set by Spring to the proxied bean, so {@link #deniedIfAdministrative} opens its own transaction. */
    @org.springframework.beans.factory.annotation.Autowired
    void setSelf(@org.springframework.context.annotation.Lazy AdminAuditRecorder self) {
        this.self = self;
    }

    private AdminAuditRecorder self() { return self == null ? this : self; }

    private void persist(String action, String targetType, String targetId, String projectId, Outcome outcome,
            AdminAuditDetails details) {
        Actor actor = currentActor();
        var spanContext = Span.current().getSpanContext();
        entityManager.persist(new AdminAuditEventEntity(Instant.now(), actor.name(), actor.principalId(),
                actor.roles(), action, targetType, truncate(targetId, 255), truncate(projectId, 255), outcome,
                spanContext.isValid() ? spanContext.getTraceId() : null, clientIp(), json(details)));
    }

    private String json(AdminAuditDetails details) {
        if (details == null || details.isEmpty()) return null;
        try {
            String value = objectMapper.writeValueAsString(details.sanitized());
            if (value.length() <= MAX_DETAILS_CHARS) return value;
            return objectMapper.writeValueAsString(Map.of("truncated", true));
        } catch (JsonProcessingException exception) {
            return null;
        }
    }

    record Actor(String name, String principalId, String roles) {}

    static Actor currentActor() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        TreeSet<String> roles = new TreeSet<>();
        if (authentication != null && authentication.isAuthenticated()) {
            for (GrantedAuthority authority : authentication.getAuthorities()) {
                String name = authority.getAuthority();
                if (name != null && (name.startsWith("ROLE_ABADA_") || name.startsWith("SCOPE_"))) roles.add(name);
            }
        }
        Identity identity = IdentityContext.get().orElse(null);
        if (identity != null) {
            if (roles.isEmpty() && identity.groups() != null) roles.addAll(identity.groups());
            return new Actor(nonBlank(identity.username()), identity.principalId(), joinRoles(roles));
        }
        String name = "anonymous";
        if (authentication instanceof JwtAuthenticationToken jwt) {
            String preferred = jwt.getToken().getClaimAsString("preferred_username");
            name = preferred == null || preferred.isBlank() ? jwt.getName() : preferred;
            List<String> groups = jwt.getToken().getClaimAsStringList("groups");
            if (roles.isEmpty() && groups != null) roles.addAll(groups);
        } else if (authentication != null && authentication.isAuthenticated()) {
            name = authentication.getName();
        }
        return new Actor(nonBlank(name), null, joinRoles(roles));
    }

    private static String joinRoles(TreeSet<String> roles) {
        return roles.isEmpty() ? null : truncate(String.join(",", roles), 2000);
    }

    private static String clientIp() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            return truncate(attributes.getRequest().getRemoteAddr(), 64);
        }
        return null;
    }

    private static String nonBlank(String value) {
        return value == null || value.isBlank() ? "anonymous" : truncate(value, 255);
    }

    private static String truncate(String value, int max) {
        return value == null || value.length() <= max ? value : value.substring(0, max);
    }
}
