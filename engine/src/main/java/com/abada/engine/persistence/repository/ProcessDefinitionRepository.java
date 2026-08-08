package com.abada.engine.persistence.repository;


import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

public interface ProcessDefinitionRepository extends JpaRepository<ProcessDefinitionEntity, String> {
    Optional<ProcessDefinitionEntity> findFirstByProcessKeyOrderByVersionDesc(String processKey);
    Optional<ProcessDefinitionEntity> findFirstByProjectIdAndProcessKeyOrderByVersionDesc(
            String projectId, String processKey);
    List<ProcessDefinitionEntity> findByProcessKeyOrderByVersionDesc(String processKey);
    List<ProcessDefinitionEntity> findAllByOrderByProcessKeyAscVersionDesc();
    Page<ProcessDefinitionEntity> findAllBy(Pageable pageable);
    Page<ProcessDefinitionEntity> findByProcessKey(String processKey, Pageable pageable);
    Page<ProcessDefinitionEntity> findByProjectId(String projectId, Pageable pageable);
    Page<ProcessDefinitionEntity> findByProjectIdAndProcessKey(
            String projectId, String processKey, Pageable pageable);
    Optional<ProcessDefinitionEntity> findFirstByDeploymentId(String deploymentId);
}
