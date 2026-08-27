package com.abada.engine.dto;

import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import java.util.Set;

public record ProjectMemberDTO(String principalId, String username, String principalType,
        Set<Role> roles, Set<String> reviewLanes, Set<String> taskGroups, long version) {
    public static ProjectMemberDTO from(ProjectMemberEntity member, PrincipalEntity principal) {
        return new ProjectMemberDTO(principal.getId(), principal.getUsername(),
                principal.getPrincipalType().name(), Set.copyOf(member.getRoles()),
                Set.copyOf(member.getReviewLanes()), Set.copyOf(member.getTaskGroups()),
                member.getEntityVersion());
    }
}
