package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.InsightProposalEntity;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

public interface InsightProposalRepository extends JpaRepository<InsightProposalEntity, Long> {

    Page<InsightProposalEntity> findByStatus(InsightProposalEntity.Status status, Pageable pageable);

    @Query("SELECT p FROM InsightProposalEntity p "
            + "WHERE p.definitionDeploymentId = :deploymentId AND p.status IN ('DRAFT', 'IN_REVIEW') "
            + "ORDER BY p.createdAt DESC")
    Optional<InsightProposalEntity> findLatestDraftForDeployment(@Param("deploymentId") String deploymentId);

    List<InsightProposalEntity> findByWindowId(long windowId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM InsightProposalEntity p WHERE p.id = :id")
    Optional<InsightProposalEntity> findByIdForUpdate(@Param("id") long id);

    Page<InsightProposalEntity> findByStatusAndDefinitionKey(
            InsightProposalEntity.Status status, String definitionKey, Pageable pageable);

    Page<InsightProposalEntity> findByDefinitionKey(String definitionKey, Pageable pageable);
}
