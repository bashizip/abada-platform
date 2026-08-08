package com.abada.engine.insight;

import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.persistence.entity.InsightApprovalPolicyEntity;
import com.abada.engine.persistence.entity.InsightProposalEntity;
import com.abada.engine.persistence.repository.InsightApprovalPolicyRepository;
import java.time.Instant;
import java.util.Arrays;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InsightPolicyService {
    private final InsightApprovalPolicyRepository policies;

    public InsightPolicyService(InsightApprovalPolicyRepository policies) {
        this.policies = policies;
    }

    public InsightApprovalPolicyEntity get(String definitionKey) {
        return policies.findById(definitionKey).orElseGet(() -> defaults(definitionKey));
    }

    @Transactional
    public InsightApprovalPolicyEntity update(String definitionKey, long expectedVersion,
            int requiredApprovals, String requiredGroups, String approvalMode, String actor) {
        if (requiredApprovals < 1 || requiredApprovals > 20) {
            throw new ProcessEngineException("requiredApprovals must be between 1 and 20");
        }
        java.util.List<String> groupList = Arrays.stream(
                        (requiredGroups == null ? "" : requiredGroups).split(","))
                .map(this::normalizeGroup).filter(value -> !value.isBlank()).distinct()
                .toList();
        String groups = String.join(",", groupList);
        if (groupList.isEmpty()) {
            throw new ProcessEngineException("At least one reviewer group is required");
        }
        if (requiredApprovals != groupList.size()) {
            throw new ProcessEngineException(
                    "requiredApprovals must equal the number of distinct reviewer groups");
        }
        InsightProposalEntity.ApprovalMode mode;
        try {
            mode = InsightProposalEntity.ApprovalMode.valueOf(approvalMode.toUpperCase());
        } catch (Exception exception) {
            throw new ProcessEngineException("approvalMode must be PARALLEL or SEQUENTIAL");
        }
        InsightApprovalPolicyEntity entity = policies.findById(definitionKey).orElse(null);
        if (entity == null) {
            if (expectedVersion != 0) {
                throw new InsightProposalService.InsightConflictException(
                        "Approval policy changed concurrently; reload before saving");
            }
            entity = defaults(definitionKey);
        } else if (entity.getPolicyVersion() != expectedVersion) {
            throw new InsightProposalService.InsightConflictException(
                    "Approval policy changed concurrently; reload before saving");
        }
        entity.setRequiredApprovals(requiredApprovals);
        entity.setRequiredGroups(groups);
        entity.setApprovalMode(mode);
        entity.setUpdatedAt(Instant.now());
        entity.setUpdatedBy(actor);
        return policies.save(entity);
    }

    private InsightApprovalPolicyEntity defaults(String definitionKey) {
        InsightApprovalPolicyEntity entity = new InsightApprovalPolicyEntity();
        entity.setDefinitionKey(definitionKey);
        entity.setRequiredApprovals(1);
        entity.setRequiredGroups("abada-insight-reviewer");
        entity.setApprovalMode(InsightProposalEntity.ApprovalMode.PARALLEL);
        entity.setUpdatedAt(Instant.EPOCH);
        entity.setUpdatedBy("system-default");
        return entity;
    }

    private String normalizeGroup(String value) {
        return value == null ? "" : value.strip().replaceFirst("^/", "").toLowerCase();
    }
}
