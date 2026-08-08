package com.abada.engine.dto;

import com.abada.engine.persistence.entity.InsightProposalEntity;

/**
 * Read view of an Insight Loop proposal. The target and proposed sources are
 * deliberately NOT included in the list view; use the detail endpoint for the
 * full diff.
 */
public record InsightProposalSummaryDTO(
        long id,
        Long windowId,
        String definitionKey,
        String definitionDeploymentId,
        int targetVersion,
        String targetChecksum,
        String status,
        String rationale,
        String adoptedDeploymentId,
        Integer adoptedVersion,
        int requiredApprovals,
        String requiredGroups,
        String approvalMode,
        java.time.Instant createdAt,
        java.time.Instant updatedAt) {

    public static InsightProposalSummaryDTO from(InsightProposalEntity entity) {
        return new InsightProposalSummaryDTO(
                entity.getId(),
                entity.getWindowId(),
                entity.getDefinitionKey(),
                entity.getDefinitionDeploymentId(),
                entity.getTargetVersion(),
                entity.getTargetChecksum(),
                entity.getStatus().name(),
                entity.getRationale(),
                entity.getAdoptedDeploymentId(),
                entity.getAdoptedVersion(),
                entity.getRequiredApprovals(),
                entity.getRequiredGroups(),
                entity.getApprovalMode().name(),
                entity.getCreatedAt(),
                entity.getUpdatedAt());
    }
}
