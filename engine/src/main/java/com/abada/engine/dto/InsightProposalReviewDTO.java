package com.abada.engine.dto;

import com.abada.engine.persistence.entity.InsightProposalReviewEntity;
import java.time.Instant;

public record InsightProposalReviewDTO(long id, String actor, String actorGroups,
        String decision, String comment, Instant createdAt) {
    public static InsightProposalReviewDTO from(InsightProposalReviewEntity entity) {
        return new InsightProposalReviewDTO(entity.getId(), entity.getActor(), entity.getActorGroups(),
                entity.getDecision().name(), entity.getComment(), entity.getCreatedAt());
    }
}
