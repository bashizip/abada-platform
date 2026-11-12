package com.abada.engine.insight;

import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.persistence.entity.InsightApprovalPolicyEntity;
import com.abada.engine.persistence.entity.InsightProposalEntity;
import com.abada.engine.persistence.entity.InsightApprovalPolicyId;
import com.abada.engine.persistence.repository.InsightApprovalPolicyRepository;
import com.abada.engine.project.ProjectConstants;
import java.time.Instant;
import java.util.Arrays;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InsightPolicyService {
    private final InsightApprovalPolicyRepository policies;

    private final com.abada.engine.audit.AdminAuditRecorder audit;

    public InsightPolicyService(InsightApprovalPolicyRepository policies,
            com.abada.engine.audit.AdminAuditRecorder audit) {
        this.audit = audit;
        this.policies = policies;
    }

    public InsightApprovalPolicyEntity get(String definitionKey) {
        return get(ProjectConstants.DEFAULT_PROJECT_ID, definitionKey);
    }

    public InsightApprovalPolicyEntity get(String projectId, String definitionKey) {
        return policies.findById(new InsightApprovalPolicyId(projectId, definitionKey))
                .orElseGet(() -> defaults(projectId, definitionKey));
    }

    @Transactional
    public InsightApprovalPolicyEntity update(String definitionKey, long expectedVersion,
            int requiredApprovals, String requiredGroups, String approvalMode, String actor) {
        return update(ProjectConstants.DEFAULT_PROJECT_ID, definitionKey, expectedVersion,
                requiredApprovals, requiredGroups, approvalMode, actor);
    }

    @Transactional
    public InsightApprovalPolicyEntity update(String projectId, String definitionKey, long expectedVersion,
            int requiredApprovals, String requiredGroups, String approvalMode, String actor) {
        return update(projectId, definitionKey, expectedVersion, requiredApprovals, requiredGroups, approvalMode,
                actor, null, null);
    }

    /** As above, and sets whether a replay must precede approval (null keeps the current setting). */
    @Transactional
    public InsightApprovalPolicyEntity update(String projectId, String definitionKey, long expectedVersion,
            int requiredApprovals, String requiredGroups, String approvalMode, String actor,
            Boolean replayRequired, Integer replayMinCases) {
        if (replayMinCases != null && (replayMinCases < 1 || replayMinCases > 100)) {
            throw new ProcessEngineException("replayMinCases must be between 1 and 100");
        }
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
        InsightApprovalPolicyEntity entity = policies
                .findById(new InsightApprovalPolicyId(projectId, definitionKey)).orElse(null);
        if (entity == null) {
            if (expectedVersion != 0) {
                throw new InsightProposalService.InsightConflictException(
                        "Approval policy changed concurrently; reload before saving");
            }
            entity = defaults(projectId, definitionKey);
        } else if (entity.getPolicyVersion() != expectedVersion) {
            throw new InsightProposalService.InsightConflictException(
                    "Approval policy changed concurrently; reload before saving");
        }
        var details = com.abada.engine.audit.AdminAuditDetails.create()
                .change("requiredApprovals", entity.getRequiredApprovals(), requiredApprovals)
                .change("requiredGroups", entity.getRequiredGroups(), groups)
                .change("approvalMode", entity.getApprovalMode(), mode);
        if (replayRequired != null) details.change("replayRequired", entity.isReplayRequired(), replayRequired);
        if (replayMinCases != null) details.change("replayMinCases", entity.getReplayMinCases(), replayMinCases);
        entity.setRequiredApprovals(requiredApprovals);
        entity.setRequiredGroups(groups);
        entity.setApprovalMode(mode);
        if (replayRequired != null) entity.setReplayRequired(replayRequired);
        if (replayMinCases != null) entity.setReplayMinCases(replayMinCases);
        entity.setUpdatedAt(Instant.now());
        entity.setUpdatedBy(actor);
        InsightApprovalPolicyEntity saved = policies.save(entity);
        audit.recordSuccess(com.abada.engine.audit.AdminAuditActions.INSIGHT_POLICY_UPDATE,
                com.abada.engine.audit.AdminAuditActions.TARGET_PROCESS, definitionKey, projectId, details);
        return saved;
    }

    private InsightApprovalPolicyEntity defaults(String projectId, String definitionKey) {
        InsightApprovalPolicyEntity entity = new InsightApprovalPolicyEntity();
        entity.setProjectId(projectId);
        entity.setDefinitionKey(definitionKey);
        entity.setRequiredApprovals(1);
        entity.setRequiredGroups(ProjectConstants.DEFAULT_PROJECT_ID.equals(projectId)
                ? "abada-insight-reviewer" : "lane:TECHNICAL");
        entity.setApprovalMode(InsightProposalEntity.ApprovalMode.PARALLEL);
        entity.setUpdatedAt(Instant.EPOCH);
        entity.setUpdatedBy("system-default");
        return entity;
    }

    private String normalizeGroup(String value) {
        return value == null ? "" : value.strip().replaceFirst("^/", "").toLowerCase();
    }
}
