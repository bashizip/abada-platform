package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.WorkerHealthEntity;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkerHealthRepository extends JpaRepository<WorkerHealthEntity, String> {
    Optional<WorkerHealthEntity> findByProjectIdAndPrincipalIdAndTopic(
            String projectId, String principalId, String topic);

    Optional<WorkerHealthEntity> findByPrincipalIdAndTopicAndProjectIdIsNull(
            String principalId, String topic);

    List<WorkerHealthEntity> findByProjectIdOrderByTopicAsc(String projectId);

    List<WorkerHealthEntity> findByProjectIdIsNull();
}