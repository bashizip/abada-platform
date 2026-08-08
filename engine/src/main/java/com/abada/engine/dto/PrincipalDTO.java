package com.abada.engine.dto;

import com.abada.engine.persistence.entity.PrincipalEntity;

public record PrincipalDTO(String id, String username, String type) {
    public static PrincipalDTO from(PrincipalEntity entity) {
        return new PrincipalDTO(entity.getId(), entity.getUsername(), entity.getPrincipalType().name());
    }
}
