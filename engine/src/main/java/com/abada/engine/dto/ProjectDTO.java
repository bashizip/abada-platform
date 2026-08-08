package com.abada.engine.dto;

import com.abada.engine.persistence.entity.ProjectEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import java.time.Instant;
import java.util.Set;

public record ProjectDTO(String id, String slug, String name, String description, String status,
        long version, Instant createdAt, Instant updatedAt, long processCount,
        Set<Role> currentUserRoles, Set<String> currentUserReviewLanes) {
}
