package com.abada.engine.persistence.repository;

import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.persistence.entity.ProcessInstanceEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

public interface ProcessInstanceRepository extends JpaRepository<ProcessInstanceEntity, String> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM ProcessInstanceEntity p WHERE p.id = :instanceId")
    Optional<ProcessInstanceEntity> findByIdForUpdate(@Param("instanceId") String instanceId);

    @Query("select p from ProcessInstanceEntity p where (:status is null or p.status = :status) "
            + "and (:processDefinitionId is null or p.processDefinitionId = :processDefinitionId)")
    Page<ProcessInstanceEntity> findFiltered(@Param("status") ProcessStatus status,
            @Param("processDefinitionId") String processDefinitionId, Pageable pageable);

    @Query("select p from ProcessInstanceEntity p where p.projectId = :projectId "
            + "and (:status is null or p.status = :status) "
            + "and (:processDefinitionId is null or p.processDefinitionId = :processDefinitionId)")
    Page<ProcessInstanceEntity> findFilteredByProject(@Param("projectId") String projectId,
            @Param("status") ProcessStatus status,
            @Param("processDefinitionId") String processDefinitionId, Pageable pageable);

    @Query("""
            SELECT p.processDefinitionId AS processDefinitionId, COUNT(p) AS instanceCount
            FROM ProcessInstanceEntity p
            WHERE p.status IN :activeStatuses
            GROUP BY p.processDefinitionId
            """)
    List<ActiveProcessCount> countActiveProcessesByDefinitionId(
            @Param("activeStatuses") Collection<ProcessStatus> activeStatuses);

    interface ActiveProcessCount {
        String getProcessDefinitionId();
        long getInstanceCount();
    }
}
