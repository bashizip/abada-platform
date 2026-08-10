package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ProjectProcessDocumentEntity;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectProcessDocumentRepository extends JpaRepository<ProjectProcessDocumentEntity, String> {
    Page<ProjectProcessDocumentEntity> findByProjectIdAndStatus(
            String projectId, ProjectProcessDocumentEntity.Status status, Pageable pageable);
    Optional<ProjectProcessDocumentEntity> findByIdAndProjectId(String id, String projectId);
    Optional<ProjectProcessDocumentEntity> findByProjectIdAndProcessKey(String projectId, String processKey);
    List<ProjectProcessDocumentEntity> findByProjectIdAndStatusOrderByNameAsc(
            String projectId, ProjectProcessDocumentEntity.Status status);
    List<ProjectProcessDocumentEntity> findByProjectIdAndStatusAndFolderIdIn(
            String projectId, ProjectProcessDocumentEntity.Status status, Collection<String> folderIds);
    long countByProjectId(String projectId);
}
