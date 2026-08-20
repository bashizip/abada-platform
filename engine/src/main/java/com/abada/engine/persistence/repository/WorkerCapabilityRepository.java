package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.WorkerCapabilityEntity;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkerCapabilityRepository extends JpaRepository<WorkerCapabilityEntity, String> {
    Optional<WorkerCapabilityEntity> findByPrincipalIdAndTopic(String principalId, String topic);

    List<WorkerCapabilityEntity> findByPrincipalId(String principalId);

    List<WorkerCapabilityEntity> findByTopic(String topic);
}