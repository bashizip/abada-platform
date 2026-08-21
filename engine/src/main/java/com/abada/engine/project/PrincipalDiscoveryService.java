package com.abada.engine.project;

import com.abada.engine.identity.IdentityProperties;
import com.abada.engine.identity.KeycloakAdminClient;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Project-member principal search that also discovers users directly from the
 * configured external identity provider. The local {@code principals} table is
 * populated only when a subject first signs in; without IdP discovery a freshly
 * created IdP user could never be found here, and
 * {@link ProjectService#putMember} would reject them as unknown. Discovered
 * users are upserted with the same issuer/subject mapping the sign-in
 * interceptor uses, so a later first login reuses the same principal row and
 * inherits the project membership.
 */
@Service
public class PrincipalDiscoveryService {

    private final PrincipalRepository principals;
    private final PrincipalService principalService;
    private final KeycloakAdminClient keycloak;
    private final IdentityProperties identityProperties;
    private final String issuerUri;

    public PrincipalDiscoveryService(PrincipalRepository principals, PrincipalService principalService,
            KeycloakAdminClient keycloak, IdentityProperties identityProperties,
            @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri:}") String issuerUri) {
        this.principals = principals;
        this.principalService = principalService;
        this.keycloak = keycloak;
        this.identityProperties = identityProperties;
        this.issuerUri = issuerUri;
    }

    @Transactional
    public Page<PrincipalEntity> search(String query, Pageable pageable) {
        String value = query == null ? "" : query.strip();
        if (!value.isBlank()) {
            discoverFromIdp(value);
        }
        return value.isBlank() ? principals.findAll(pageable)
                : principals.findByUsernameContainingIgnoreCase(value, pageable);
    }

    private void discoverFromIdp(String query) {
        if (!identityProperties.isConfigured() || issuerUri == null || issuerUri.isBlank()) {
            return;
        }
        try {
            for (JsonNode user : keycloak.listUsers(query)) {
                String id = user.hasNonNull("id") ? user.get("id").asText() : null;
                String username = user.hasNonNull("username") ? user.get("username").asText() : null;
                if (id == null || id.isBlank() || username == null || username.isBlank()) {
                    continue;
                }
                // Keycloak access tokens carry the internal user id as `sub` and
                // the realm issuer, matching IdentityContextInterceptor's mapping.
                PrincipalEntity.Type type = username.startsWith("service-account-")
                        ? PrincipalEntity.Type.SERVICE
                        : PrincipalEntity.Type.HUMAN;
                principalService.observe(issuerUri, id, username, type);
            }
        } catch (Exception ignored) {
            // IdP unreachable: fall back to locally observed principals only
        }
    }
}
