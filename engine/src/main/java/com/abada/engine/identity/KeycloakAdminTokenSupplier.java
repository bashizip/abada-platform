package com.abada.engine.identity;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Caches a Keycloak service-account access token and refreshes it before expiry.
 * The token is used to call the Keycloak Admin REST API server-side.
 */
@Component
public class KeycloakAdminTokenSupplier {

    private static final Duration REFRESH_MARGIN = Duration.ofSeconds(30);

    private final IdentityProperties properties;
    private final RestClient restClient;
    private final AtomicReference<CachedToken> cached = new AtomicReference<>();

    public KeycloakAdminTokenSupplier(IdentityProperties properties) {
        this.properties = properties;
        this.restClient = RestClient.builder()
                .baseUrl(properties.url())
                .build();
    }

    /**
     * Returns a valid access token, refreshing if necessary.
     * @return the service-account access token string
     */
    public String getToken() {
        CachedToken current = cached.get();
        if (current != null && current.isValid()) {
            return current.token;
        }
        return refreshToken();
    }

    private synchronized String refreshToken() {
        CachedToken current = cached.get();
        if (current != null && current.isValid()) {
            return current.token;
        }

        String tokenEndpoint = "/realms/" + properties.realm()
                + "/protocol/openid-connect/token";

        JsonNode response = restClient.post()
                .uri(tokenEndpoint)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body("grant_type=client_credentials"
                        + "&client_id=" + properties.clientId()
                        + "&client_secret=" + properties.clientSecret())
                .retrieve()
                .body(JsonNode.class);

        if (response == null || !response.has("access_token")) {
            throw new IllegalStateException("Keycloak token endpoint returned no access_token");
        }

        String token = response.get("access_token").asText();
        long expiresIn = response.has("expires_in") ? response.get("expires_in").asLong() : 60;
        Instant expiresAt = Instant.now().plusSeconds(expiresIn);

        cached.set(new CachedToken(token, expiresAt));
        return token;
    }

    private record CachedToken(String token, Instant expiresAt) {
        boolean isValid() {
            return token != null && Instant.now().isBefore(expiresAt.minus(REFRESH_MARGIN));
        }
    }
}
