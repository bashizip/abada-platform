package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ProjectEntity;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectRepository extends JpaRepository<ProjectEntity, String> {
    Optional<ProjectEntity> findBySlug(String slug);
    Page<ProjectEntity> findByStatus(ProjectEntity.Status status, Pageable pageable);
    List<ProjectEntity> findAllByStatus(ProjectEntity.Status status);
}
