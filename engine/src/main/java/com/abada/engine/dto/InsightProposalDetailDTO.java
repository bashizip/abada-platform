package com.abada.engine.dto;

import com.abada.engine.persistence.entity.InsightProposalEntity;

/**
 * Detail view of a proposal: the source that produced the signal and the
 * proposed replacement, both as full text. Used by the adoption review UI.
 */
public record InsightProposalDetailDTO(
        long id,
        Long windowId,
        String definitionKey,
        String definitionDeploymentId,
        int targetVersion,
        String targetChecksum,
        String status,
        String rationale,
        String targetSource,
        String proposedSource,
        String adoptedDeploymentId,
        Integer adoptedVersion,
        int requiredApprovals,
        String requiredGroups,
        String approvalMode,
        java.util.List<InsightProposalReviewDTO> reviews,
        java.time.Instant createdAt,
        java.time.Instant updatedAt) {

    public static InsightProposalDetailDTO from(InsightProposalEntity entity) {
        return new InsightProposalDetailDTO(
                entity.getId(),
                entity.getWindowId(),
                entity.getDefinitionKey(),
                entity.getDefinitionDeploymentId(),
                entity.getTargetVersion(),
                entity.getTargetChecksum(),
                entity.getStatus().name(),
                entity.getRationale(),
                entity.getTargetSource(),
                entity.getProposedSource(),
                entity.getAdoptedDeploymentId(),
                entity.getAdoptedVersion(),
                entity.getRequiredApprovals(),
                entity.getRequiredGroups(),
                entity.getApprovalMode().name(),
                java.util.List.of(),
                entity.getCreatedAt(),
                entity.getUpdatedAt());
    }

    public static InsightProposalDetailDTO from(InsightProposalEntity entity,
            java.util.List<com.abada.engine.persistence.entity.InsightProposalReviewEntity> reviews) {
        InsightProposalDetailDTO base = from(entity);
        return new InsightProposalDetailDTO(base.id(), base.windowId(), base.definitionKey(),
                base.definitionDeploymentId(), base.targetVersion(), base.targetChecksum(), base.status(),
                base.rationale(), base.targetSource(), base.proposedSource(), base.adoptedDeploymentId(),
                base.adoptedVersion(), base.requiredApprovals(), base.requiredGroups(), base.approvalMode(),
                reviews.stream().map(InsightProposalReviewDTO::from).toList(), base.createdAt(), base.updatedAt());
    }
}
