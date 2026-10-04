package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.AgentStepEntity;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AgentStepRepository extends JpaRepository<AgentStepEntity, String> {
    List<AgentStepEntity> findByExternalTaskIdAndAttemptOrderBySequenceAsc(String externalTaskId, int attempt);

    List<AgentStepEntity> findByExternalTaskIdOrderByAttemptAscSequenceAsc(String externalTaskId);

    Optional<AgentStepEntity> findByExternalTaskIdAndAttemptAndSequence(String externalTaskId, int attempt,
            int sequence);

    Optional<AgentStepEntity> findFirstByExternalTaskIdAndAttemptOrderBySequenceDesc(String externalTaskId,
            int attempt);

    long countByExternalTaskId(String externalTaskId);

    List<AgentStepEntity> findByProcessInstanceIdOrderByStartedAtAscSequenceAsc(String processInstanceId);
}
