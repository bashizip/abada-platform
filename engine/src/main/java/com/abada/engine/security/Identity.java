package com.abada.engine.security;

import java.util.List;

/**
 * Represents the identity of the user making a request.
 * @param principalId Stable Abada principal identifier, resolved from issuer + subject.
 * @param username Human-readable actor name.
 * @param groups A list of groups or roles the user belongs to.
 */
public record Identity(String principalId, String username, List<String> groups) {
    public Identity(String username, List<String> groups) {
        this(null, username, groups);
    }
}
