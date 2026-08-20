package com.abada.engine.dto;

import java.util.List;

/**
 * Request body for updating a user via the platform admin API.
 * All fields are optional — only non-null fields are applied.
 */
public record UpdateUserRequest(
        String email,
        String firstName,
        String lastName,
        Boolean enabled,
        List<String> addGroups,
        List<String> removeGroups) {
}
