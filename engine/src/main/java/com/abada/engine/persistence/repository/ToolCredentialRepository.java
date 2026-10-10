package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ToolCredentialEntity;
import com.abada.engine.persistence.entity.ToolCredentialId;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ToolCredentialRepository extends JpaRepository<ToolCredentialEntity, ToolCredentialId> {
    List<ToolCredentialEntity> findByProjectIdOrderByNameAsc(String projectId);
}
