package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ProjectMemberEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectMemberRepository extends JpaRepository<ProjectMemberEntity, String> {
    Optional<ProjectMemberEntity> findByProjectIdAndPrincipalId(String projectId, String principalId);
    List<ProjectMemberEntity> findByProjectIdOrderByCreatedAtAsc(String projectId);
    List<ProjectMemberEntity> findByPrincipalId(String principalId);

    @Query("select count(m) from ProjectMemberEntity m join m.roles r where m.projectId = :projectId and r = :role")
    long countByProjectIdAndRole(@Param("projectId") String projectId, @Param("role") Role role);
}
