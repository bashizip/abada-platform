package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ProcessTokenEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcessTokenRepository extends JpaRepository<ProcessTokenEntity, String> {
    List<ProcessTokenEntity> findByProcessInstanceIdOrderByCreatedAtAscIdAsc(String processInstanceId);

    void deleteByProcessInstanceId(String processInstanceId);
}
