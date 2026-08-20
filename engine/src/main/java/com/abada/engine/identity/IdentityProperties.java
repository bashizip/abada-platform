package com.abada.engine.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuration for the Keycloak Admin API proxy.
 * The engine uses these credentials to obtain a service-account token
 * for calling the Keycloak Admin REST API on behalf of platform administrators.
 */
@ConfigurationProperties(prefix = "abada.identity.admin")
public record IdentityProperties(
        String url,
        String realm,
        String clientId,
        String clientSecret) {

    public boolean isConfigured() {
        return url != null && !url.isBlank()
                && realm != null && !realm.isBlank()
                && clientId != null && !clientId.isBlank()
                && clientSecret != null && !clientSecret.isBlank();
    }
}
