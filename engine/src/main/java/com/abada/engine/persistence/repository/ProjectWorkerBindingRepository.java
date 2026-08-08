package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ProjectWorkerBindingEntity;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectWorkerBindingRepository extends JpaRepository<ProjectWorkerBindingEntity, String> {
    Optional<ProjectWorkerBindingEntity> findByProjectIdAndPrincipalId(String projectId, String principalId);
    List<ProjectWorkerBindingEntity> findByPrincipalId(String principalId);
    List<ProjectWorkerBindingEntity> findByProjectId(String projectId);
}
