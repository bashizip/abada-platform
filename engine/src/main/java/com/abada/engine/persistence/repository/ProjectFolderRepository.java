package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ProjectFolderEntity;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectFolderRepository extends JpaRepository<ProjectFolderEntity, String> {
    Optional<ProjectFolderEntity> findByIdAndProjectId(String id, String projectId);
    List<ProjectFolderEntity> findByProjectIdOrderByNameAsc(String projectId);
    List<ProjectFolderEntity> findByIdIn(Collection<String> ids);
}