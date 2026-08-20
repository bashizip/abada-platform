package com.abada.engine.dto;

import java.util.List;

/**
 * Request body for creating a user via the platform admin API.
 */
public record CreateUserRequest(
        String username,
        String email,
        String firstName,
        String lastName,
        String password,
        boolean enabled,
        List<String> groupIds) {
}
