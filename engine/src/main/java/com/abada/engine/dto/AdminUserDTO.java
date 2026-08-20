package com.abada.engine.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * Clean user DTO returned by the platform admin API.
 * Maps from Keycloak Admin REST API user representation.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AdminUserDTO(
        String id,
        String username,
        String email,
        String firstName,
        String lastName,
        boolean enabled,
        List<String> groups,
        long createdTimestamp) {
}
