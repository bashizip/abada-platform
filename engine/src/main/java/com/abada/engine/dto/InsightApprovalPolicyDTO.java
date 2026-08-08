package com.abada.engine.dto;

import com.abada.engine.persistence.entity.InsightApprovalPolicyEntity;
import java.time.Instant;

public record InsightApprovalPolicyDTO(String definitionKey, long policyVersion,
        int requiredApprovals, String requiredGroups, String approvalMode,
        Instant updatedAt, String updatedBy) {
    public static InsightApprovalPolicyDTO from(InsightApprovalPolicyEntity entity) {
        return new InsightApprovalPolicyDTO(entity.getDefinitionKey(), entity.getPolicyVersion(),
                entity.getRequiredApprovals(), entity.getRequiredGroups(), entity.getApprovalMode().name(),
                entity.getUpdatedAt(), entity.getUpdatedBy());
    }
}
