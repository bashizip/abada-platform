package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.IncidentEntity;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface IncidentRepository extends JpaRepository<IncidentEntity, String> {
    List<IncidentEntity> findByProcessInstanceIdOrderByCreatedAtAsc(String processInstanceId);

    List<IncidentEntity> findByProcessInstanceIdAndResolvedAtIsNull(String processInstanceId);

    List<IncidentEntity> findByProjectIdOrderByCreatedAtDesc(String projectId, Pageable page);

    List<IncidentEntity> findByProjectIdAndResolvedAtIsNullOrderByCreatedAtDesc(String projectId, Pageable page);
}
