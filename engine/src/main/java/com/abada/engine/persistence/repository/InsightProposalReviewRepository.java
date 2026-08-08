package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.InsightProposalReviewEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InsightProposalReviewRepository extends JpaRepository<InsightProposalReviewEntity, Long> {
    List<InsightProposalReviewEntity> findByProposalIdOrderByCreatedAtAsc(long proposalId);
    long countByProposalIdAndDecision(long proposalId, InsightProposalReviewEntity.Decision decision);
    boolean existsByProposalIdAndActor(long proposalId, String actor);
}
