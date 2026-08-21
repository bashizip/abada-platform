package com.abada.engine.identity;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Proxies user and group management operations to the Keycloak Admin REST API.
 * All calls are made server-side using a service-account token; the caller's
 * JWT is never forwarded to Keycloak.
 */
@Component
public class KeycloakAdminClient {

    private final IdentityProperties properties;
    private final KeycloakAdminTokenSupplier tokenSupplier;
    private final RestClient restClient;

    public KeycloakAdminClient(IdentityProperties properties,
            KeycloakAdminTokenSupplier tokenSupplier) {
        this.properties = properties;
        this.tokenSupplier = tokenSupplier;
        this.restClient = RestClient.builder()
                .baseUrl(properties.url())
                .requestFactory(requestFactory())
                .build();
    }

    private static SimpleClientHttpRequestFactory requestFactory() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(3));
        factory.setReadTimeout(Duration.ofSeconds(10));
        return factory;
    }

    private String adminBase() {
        return "/admin/realms/" + properties.realm();
    }

    private String authHeader() {
        return "Bearer " + tokenSupplier.getToken();
    }

    // ── Users ──

    public List<JsonNode> listUsers(String query) {
        String uri = adminBase() + "/users";
        Map<String, String> params;
        if (query != null && !query.isBlank()) {
            params = Map.of("search", query, "max", "100");
        } else {
            params = Map.of("max", "100");
        }

        JsonNode[] users = restClient.get()
                .uri(uri, params)
                .header("Authorization", authHeader())
                .retrieve()
                .body(JsonNode[].class);

        if (users == null) {
            return List.of();
        }
        return List.of(users);
    }

    public JsonNode getUser(String userId) {
        return restClient.get()
                .uri(adminBase() + "/users/" + userId)
                .header("Authorization", authHeader())
                .retrieve()
                .body(JsonNode.class);
    }

    public String createUser(Map<String, Object> userRepresentation) {
        // Keycloak returns 201 with Location header containing the new user ID
        restClient.post()
                .uri(adminBase() + "/users")
                .header("Authorization", authHeader())
                .contentType(MediaType.APPLICATION_JSON)
                .body(userRepresentation)
                .retrieve()
                .toBodilessEntity();

        // Fetch the user by username to get the ID (Keycloak doesn't return it in the create response)
        String username = (String) userRepresentation.get("username");
        if (username == null) {
            return null;
        }
        JsonNode[] matches = restClient.get()
                .uri(adminBase() + "/users", Map.of("username", username, "exact", "true", "max", "1"))
                .header("Authorization", authHeader())
                .retrieve()
                .body(JsonNode[].class);

        if (matches != null && matches.length > 0) {
            return matches[0].get("id").asText();
        }
        return null;
    }

    public void updateUser(String userId, Map<String, Object> userRepresentation) {
        restClient.put()
                .uri(adminBase() + "/users/" + userId)
                .header("Authorization", authHeader())
                .contentType(MediaType.APPLICATION_JSON)
                .body(userRepresentation)
                .retrieve()
                .toBodilessEntity();
    }

    public void assignGroup(String userId, String groupId) {
        restClient.put()
                .uri(adminBase() + "/users/" + userId + "/groups/" + groupId)
                .header("Authorization", authHeader())
                .retrieve()
                .toBodilessEntity();
    }

    public void revokeGroup(String userId, String groupId) {
        restClient.delete()
                .uri(adminBase() + "/users/" + userId + "/groups/" + groupId)
                .header("Authorization", authHeader())
                .retrieve()
                .toBodilessEntity();
    }

    public List<JsonNode> getUserGroups(String userId) {
        JsonNode[] groups = restClient.get()
                .uri(adminBase() + "/users/" + userId + "/groups")
                .header("Authorization", authHeader())
                .retrieve()
                .body(JsonNode[].class);

        if (groups == null) {
            return List.of();
        }
        return List.of(groups);
    }

    // ── Groups ──

    public List<JsonNode> listGroups() {
        JsonNode[] groups = restClient.get()
                .uri(adminBase() + "/groups")
                .header("Authorization", authHeader())
                .retrieve()
                .body(JsonNode[].class);

        if (groups == null) {
            return List.of();
        }
        return List.of(groups);
    }

    public String createGroup(String name) {
        restClient.post()
                .uri(adminBase() + "/groups")
                .header("Authorization", authHeader())
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("name", name))
                .retrieve()
                .toBodilessEntity();

        // Fetch the group by name to get its ID
        JsonNode[] allGroups = restClient.get()
                .uri(adminBase() + "/groups")
                .header("Authorization", authHeader())
                .retrieve()
                .body(JsonNode[].class);

        if (allGroups != null) {
            for (JsonNode g : allGroups) {
                if (name.equals(g.get("name").asText())) {
                    return g.get("id").asText();
                }
            }
        }
        return null;
    }

    // ── Group Members ──

    public List<JsonNode> getGroupMembers(String groupId) {
        JsonNode[] members = restClient.get()
                .uri(adminBase() + "/groups/" + groupId + "/members")
                .header("Authorization", authHeader())
                .retrieve()
                .body(JsonNode[].class);

        if (members == null) {
            return List.of();
        }
        return List.of(members);
    }
}
