package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ProjectProcessDocumentEntity;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectProcessDocumentRepository extends JpaRepository<ProjectProcessDocumentEntity, String> {
    Page<ProjectProcessDocumentEntity> findByProjectIdAndStatus(
            String projectId, ProjectProcessDocumentEntity.Status status, Pageable pageable);
    Optional<ProjectProcessDocumentEntity> findByIdAndProjectId(String id, String projectId);
    Optional<ProjectProcessDocumentEntity> findByProjectIdAndProcessKey(String projectId, String processKey);
    long countByProjectId(String projectId);
}
