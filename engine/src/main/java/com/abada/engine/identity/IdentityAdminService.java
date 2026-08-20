package com.abada.engine.identity;

import com.abada.engine.dto.AdminGroupDTO;
import com.abada.engine.dto.AdminUserDTO;
import com.abada.engine.dto.CreateUserRequest;
import com.abada.engine.dto.UpdateUserRequest;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Orchestrates platform admin identity operations by proxying to Keycloak
 * Admin REST API. The caller must already be authorized (abada-admin group)
 * before reaching this service.
 */
@Service
public class IdentityAdminService {

    private final KeycloakAdminClient keycloakClient;

    public IdentityAdminService(KeycloakAdminClient keycloakClient) {
        this.keycloakClient = keycloakClient;
    }

    // ── Users ──

    public List<AdminUserDTO> listUsers(String query) {
        List<JsonNode> kcUsers = keycloakClient.listUsers(query);
        List<AdminUserDTO> result = new ArrayList<>(kcUsers.size());
        for (JsonNode u : kcUsers) {
            result.add(toUserDTO(u, null));
        }
        return result;
    }

    public AdminUserDTO getUser(String userId) {
        JsonNode kcUser = keycloakClient.getUser(userId);
        if (kcUser == null) {
            return null;
        }
        List<JsonNode> groups = keycloakClient.getUserGroups(userId);
        return toUserDTO(kcUser, groups);
    }

    public AdminUserDTO createUser(CreateUserRequest request) {
        Map<String, Object> userRep = new HashMap<>();
        userRep.put("username", request.username());
        userRep.put("email", request.email());
        userRep.put("firstName", request.firstName());
        userRep.put("lastName", request.lastName());
        userRep.put("enabled", request.enabled());
        if (request.password() != null && !request.password().isBlank()) {
            userRep.put("credentials", List.of(Map.of(
                    "type", "password",
                    "value", request.password(),
                    "temporary", false)));
        }

        String userId = keycloakClient.createUser(userRep);

        // Assign groups if specified
        if (userId != null && request.groupIds() != null) {
            for (String groupId : request.groupIds()) {
                keycloakClient.assignGroup(userId, groupId);
            }
        }

        return getUser(userId);
    }

    public AdminUserDTO updateUser(String userId, UpdateUserRequest request) {
        JsonNode existing = keycloakClient.getUser(userId);
        if (existing == null) {
            return null;
        }

        Map<String, Object> updates = new HashMap<>();
        if (request.email() != null) {
            updates.put("email", request.email());
        }
        if (request.firstName() != null) {
            updates.put("firstName", request.firstName());
        }
        if (request.lastName() != null) {
            updates.put("lastName", request.lastName());
        }
        if (request.enabled() != null) {
            updates.put("enabled", request.enabled());
        }
        if (!updates.isEmpty()) {
            // Merge with existing fields to avoid wiping them
            Map<String, Object> merged = new HashMap<>();
            putIfNotNull(merged, "username", existing, "username");
            putIfNotNull(merged, "email", existing, "email");
            putIfNotNull(merged, "firstName", existing, "firstName");
            putIfNotNull(merged, "lastName", existing, "lastName");
            merged.put("enabled", updates.getOrDefault("enabled",
                    existing.has("enabled") ? existing.get("enabled").asBoolean() : true));
            if (updates.containsKey("email")) {
                merged.put("email", updates.get("email"));
            }
            if (updates.containsKey("firstName")) {
                merged.put("firstName", updates.get("firstName"));
            }
            if (updates.containsKey("lastName")) {
                merged.put("lastName", updates.get("lastName"));
            }
            keycloakClient.updateUser(userId, merged);
        }

        if (request.addGroups() != null) {
            for (String groupId : request.addGroups()) {
                keycloakClient.assignGroup(userId, groupId);
            }
        }
        if (request.removeGroups() != null) {
            for (String groupId : request.removeGroups()) {
                keycloakClient.revokeGroup(userId, groupId);
            }
        }

        return getUser(userId);
    }

    public void assignGroup(String userId, String groupId) {
        keycloakClient.assignGroup(userId, groupId);
    }

    public void revokeGroup(String userId, String groupId) {
        keycloakClient.revokeGroup(userId, groupId);
    }

    // ── Groups ──

    public List<AdminGroupDTO> listGroups() {
        List<JsonNode> kcGroups = keycloakClient.listGroups();
        List<AdminGroupDTO> result = new ArrayList<>(kcGroups.size());
        for (JsonNode g : kcGroups) {
            String groupId = g.has("id") ? g.get("id").asText() : null;
            long memberCount = 0;
            if (groupId != null) {
                try {
                    memberCount = keycloakClient.getGroupMembers(groupId).size();
                } catch (Exception ignored) {
                    // Non-fatal: return 0 if members endpoint fails
                }
            }
            result.add(new AdminGroupDTO(
                    groupId,
                    g.has("name") ? g.get("name").asText() : null,
                    g.has("path") ? g.get("path").asText() : null,
                    memberCount));
        }
        return result;
    }

    public AdminGroupDTO createGroup(String name) {
        String groupId = keycloakClient.createGroup(name);
        if (groupId == null) {
            return null;
        }
        return new AdminGroupDTO(groupId, name, "/" + name, 0);
    }

    // ── Mapping ──

    private AdminUserDTO toUserDTO(JsonNode u, List<JsonNode> groups) {
        List<String> groupNames = new ArrayList<>();
        if (groups != null) {
            for (JsonNode g : groups) {
                if (g.has("name")) {
                    groupNames.add(g.get("name").asText());
                }
            }
        }
        return new AdminUserDTO(
                u.has("id") ? u.get("id").asText() : null,
                u.has("username") ? u.get("username").asText() : null,
                u.has("email") ? u.get("email").asText() : null,
                u.has("firstName") ? u.get("firstName").asText() : null,
                u.has("lastName") ? u.get("lastName").asText() : null,
                u.has("enabled") && u.get("enabled").asBoolean(),
                groupNames,
                u.has("createdTimestamp") ? u.get("createdTimestamp").asLong() : 0);
    }

    private void putIfNotNull(Map<String, Object> map, String key, JsonNode source, String field) {
        if (source.has(field) && !source.get(field).isNull()) {
            map.put(key, source.get(field).asText());
        }
    }
}
