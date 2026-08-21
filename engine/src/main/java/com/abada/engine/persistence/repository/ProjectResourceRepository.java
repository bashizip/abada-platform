package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ProjectResourceEntity;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectResourceRepository extends JpaRepository<ProjectResourceEntity, String> {
    Optional<ProjectResourceEntity> findByIdAndProjectId(String id, String projectId);
    List<ProjectResourceEntity> findByProjectIdOrderByNameAsc(String projectId);
    List<ProjectResourceEntity> findByFolderIdIn(Collection<String> folderIds);
    List<ProjectResourceEntity> findByProjectIdAndKindOrderByNameAsc(String projectId,
            ProjectResourceEntity.Kind kind);
    Optional<ProjectResourceEntity> findByProjectIdAndFolderIdAndName(String projectId,
            String folderId, String name);
    boolean existsByProjectIdAndFolderIdAndName(String projectId, String folderId, String name);
}