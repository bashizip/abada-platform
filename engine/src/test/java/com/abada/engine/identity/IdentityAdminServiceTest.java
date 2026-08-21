package com.abada.engine.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.abada.engine.dto.AdminUserDTO;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

class IdentityAdminServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final KeycloakAdminClient keycloak = mock(KeycloakAdminClient.class);
    private final IdentityAdminService service = new IdentityAdminService(keycloak);

    @Test
    void listUsersAttachesRealGroupMemberships() {
        when(keycloak.listUsers(null)).thenReturn(List.of(user("u1", "alice"), user("u2", "bob")));
        when(keycloak.listGroups()).thenReturn(List.of(group("g1", "abada-admin"), group("g2", "customers")));
        when(keycloak.getGroupMembers("g1")).thenReturn(List.of(user("u1", "alice")));
        when(keycloak.getGroupMembers("g2")).thenReturn(List.of());

        List<AdminUserDTO> users = service.listUsers(null);

        assertThat(users).hasSize(2);
        assertThat(users.get(0).groups()).containsExactly("abada-admin");
        assertThat(users.get(1).groups()).isEmpty();
    }

    @Test
    void listUsersToleratesGroupMemberLookupFailures() {
        when(keycloak.listUsers(null)).thenReturn(List.of(user("u1", "alice")));
        when(keycloak.listGroups()).thenReturn(List.of(group("g1", "abada-admin")));
        when(keycloak.getGroupMembers("g1")).thenThrow(new RuntimeException("idp timeout"));

        List<AdminUserDTO> users = service.listUsers(null);

        assertThat(users).hasSize(1);
        assertThat(users.get(0).groups()).isEmpty();
    }

    @Test
    void getUserReturnsGroupsFromMembershipEndpoint() {
        when(keycloak.getUser("u1")).thenReturn(user("u1", "alice"));
        when(keycloak.getUserGroups("u1"))
                .thenReturn(List.of(group("g2", "customers"), group("g1", "abada-admin")));

        AdminUserDTO dto = service.getUser("u1");

        assertThat(dto.groups()).containsExactly("abada-admin", "customers");
    }

    @Test
    void getUserReturnsNullWhenUserDoesNotExist() {
        when(keycloak.getUser("missing")).thenReturn(null);

        assertThat(service.getUser("missing")).isNull();
    }

    private JsonNode user(String id, String username) {
        return MAPPER.createObjectNode()
                .put("id", id)
                .put("username", username)
                .put("enabled", true)
                .put("createdTimestamp", 1719000000000L);
    }

    private JsonNode group(String id, String name) {
        return MAPPER.createObjectNode()
                .put("id", id)
                .put("name", name)
                .put("path", "/" + name);
    }
}
