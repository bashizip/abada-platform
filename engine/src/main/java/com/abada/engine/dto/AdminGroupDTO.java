package com.abada.engine.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Clean group DTO returned by the platform admin API.
 * Maps from Keycloak Admin REST API group representation.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AdminGroupDTO(
        String id,
        String name,
        String path,
        long memberCount) {
}
