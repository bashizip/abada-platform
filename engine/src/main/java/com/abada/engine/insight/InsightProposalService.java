package com.abada.engine.insight;

import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.insight.InsightAnalyzer.Finding;
import com.abada.engine.persistence.entity.InsightProposalEntity;
import com.abada.engine.persistence.entity.InsightApprovalPolicyEntity;
import com.abada.engine.persistence.entity.InsightApprovalPolicyId;
import com.abada.engine.persistence.entity.InsightProposalReviewEntity;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.persistence.repository.InsightApprovalPolicyRepository;
import com.abada.engine.persistence.repository.InsightProposalRepository;
import com.abada.engine.persistence.repository.InsightProposalReviewRepository;
import com.abada.engine.persistence.repository.ProcessDefinitionRepository;
import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.project.ProjectConstants;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.Set;
import java.util.Arrays;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Proposal lifecycle: creation from window findings (one DRAFT per
 * deployment, no duplicates) and governed adoption. Adopting deploys the
 * proposed source as a NEW immutable definition version through the normal
 * engine deploy path; already-running instances are never touched.
 */
@Service
public class InsightProposalService {

    private static final Logger log = LoggerFactory.getLogger(InsightProposalService.class);

    private final InsightProposalRepository proposals;
    private final ProcessDefinitionRepository definitions;
    private final InsightProposalGenerator generator;
    private final AbadaEngine engine;
    private final InsightApprovalPolicyRepository policies;
    private final InsightProposalReviewRepository reviews;
    private final ActivityHistoryService history;

    public InsightProposalService(InsightProposalRepository proposals,
            ProcessDefinitionRepository definitions, InsightProposalGenerator generator,
            AbadaEngine engine, InsightApprovalPolicyRepository policies,
            InsightProposalReviewRepository reviews, ActivityHistoryService history) {
        this.proposals = proposals;
        this.definitions = definitions;
        this.generator = generator;
        this.engine = engine;
        this.policies = policies;
        this.reviews = reviews;
        this.history = history;
    }

    /** Creates DRAFT proposals for each deployment with findings (max one per deployment). */
    public int createProposalsForWindow(long windowId, List<Finding> findings) {
        int created = 0;
        Map<String, List<Finding>> byDeployment = findings.stream().collect(
                java.util.stream.Collectors.groupingBy(f -> f.key().deploymentId(),
                        LinkedHashMap::new, java.util.stream.Collectors.toList()));
        for (List<Finding> deploymentFindings : byDeployment.values()) {
            Finding finding = deploymentFindings.getFirst();
            ProcessDefinitionEntity definition = definitions
                    .findFirstByDeploymentId(finding.key().deploymentId()).orElse(null);
            if (definition == null) {
                continue;
            }
            Optional<InsightProposalEntity> existing =
                    proposals.findLatestDraftForDeployment(definition.getDeploymentId());
            if (existing.isPresent()) {
                continue;
            }
            if (!"APL_NATIVE".equals(definition.getSchemaType())) {
                continue;
            }
            InsightProposalGenerator.Proposal generated = generator.generate(
                    definition.getProcessKey(), definition.getBpmnXml(), deploymentFindings);
            InsightApprovalPolicyEntity policy = policies.findById(new InsightApprovalPolicyId(
                    definition.getProjectId(), definition.getProcessKey())).orElse(null);
            InsightProposalEntity proposal = new InsightProposalEntity();
            proposal.setProjectId(definition.getProjectId());
            proposal.setWindowId(windowId);
            proposal.setDefinitionKey(definition.getProcessKey());
            proposal.setDefinitionDeploymentId(definition.getDeploymentId());
            proposal.setTargetVersion(definition.getVersion());
            proposal.setTargetChecksum(definition.getChecksum());
            proposal.setTargetSource(definition.getBpmnXml());
            proposal.setProposedSource(generated.proposedSource());
            proposal.setRationale(generated.rationale());
            proposal.setStatus(InsightProposalEntity.Status.DRAFT);
            proposal.setRequiredApprovals(policy == null ? 1 : policy.getRequiredApprovals());
            proposal.setRequiredGroups(policy == null
                    ? (ProjectConstants.DEFAULT_PROJECT_ID.equals(definition.getProjectId())
                            ? "abada-insight-reviewer" : "lane:TECHNICAL")
                    : policy.getRequiredGroups());
            proposal.setApprovalMode(policy == null ? InsightProposalEntity.ApprovalMode.PARALLEL
                    : policy.getApprovalMode());
            proposal.setCreatedAt(Instant.now());
            proposal.setUpdatedAt(Instant.now());
            proposals.save(proposal);
            created++;
            log.info("Created insight proposal {} for definition {} version {}",
                    proposal.getId(), definition.getProcessKey(), definition.getVersion());
        }
        return created;
    }

    /**
     * Adds one governed review. A rejection is terminal. The last required
     * approval deploys only if the proposal still targets the latest checksum.
     */
    @Transactional
    public InsightProposalEntity review(long proposalId, String actor, List<String> actorGroups,
            InsightProposalReviewEntity.Decision decision, String comment, Instant expectedUpdatedAt) {
        return review(ProjectConstants.DEFAULT_PROJECT_ID, proposalId, actor, actorGroups,
                decision, comment, expectedUpdatedAt);
    }

    @Transactional
    public InsightProposalEntity review(String projectId, long proposalId, String actor,
            List<String> actorGroups, InsightProposalReviewEntity.Decision decision,
            String comment, Instant expectedUpdatedAt) {
        InsightProposalEntity proposal = proposals.findByIdForUpdate(proposalId)
                .orElseThrow(() -> new InsightNotFoundException(proposalId));
        if (!projectId.equals(proposal.getProjectId())) {
            throw new InsightNotFoundException(proposalId);
        }
        if (proposal.getStatus() != InsightProposalEntity.Status.DRAFT
                && proposal.getStatus() != InsightProposalEntity.Status.IN_REVIEW) {
            throw new InsightConflictException(
                    "Proposal %d is already %s".formatted(proposalId, proposal.getStatus()));
        }
        if (expectedUpdatedAt != null && !expectedUpdatedAt.equals(proposal.getUpdatedAt())) {
            throw new InsightConflictException("Proposal changed concurrently; reload before reviewing");
        }
        if (reviews.existsByProposalIdAndActor(proposalId, actor)) {
            throw new InsightConflictException("Actor already reviewed proposal " + proposalId);
        }
        if (decision == InsightProposalReviewEntity.Decision.REJECT
                && (comment == null || comment.isBlank())) {
            throw new ProcessEngineException("A rejection comment is required");
        }
        validateReviewer(proposal, actorGroups);

        InsightProposalReviewEntity review = new InsightProposalReviewEntity();
        review.setProposalId(proposalId);
        review.setActor(actor);
        review.setActorGroups(String.join(",", actorGroups));
        review.setDecision(decision);
        review.setComment(comment == null ? null : comment.strip());
        review.setCreatedAt(Instant.now());
        reviews.save(review);

        if (decision == InsightProposalReviewEntity.Decision.REJECT) {
            proposal.setStatus(InsightProposalEntity.Status.REJECTED);
        } else {
            if (approvalThresholdSatisfied(proposal)) {
                adoptCurrentTarget(proposal);
            } else {
                proposal.setStatus(InsightProposalEntity.Status.IN_REVIEW);
            }
        }
        proposal.setUpdatedAt(Instant.now());
        proposals.save(proposal);
        history.record("INSIGHT_PROPOSAL_REVIEWED", null, proposal.getDefinitionKey(), null,
                Map.of("proposalId", proposalId, "actor", actor, "decision", decision.name(),
                        "status", proposal.getStatus().name(), "targetVersion", proposal.getTargetVersion(),
                        "adoptedVersion", proposal.getAdoptedVersion() == null ? -1 : proposal.getAdoptedVersion()));
        return proposal;
    }

    private boolean approvalThresholdSatisfied(InsightProposalEntity proposal) {
        List<InsightProposalReviewEntity> approvals = reviews.findByProposalIdOrderByCreatedAtAsc(proposal.getId())
                .stream().filter(review -> review.getDecision() == InsightProposalReviewEntity.Decision.APPROVE)
                .toList();
        if (approvals.size() < proposal.getRequiredApprovals()) return false;
        if (proposal.getApprovalMode() == InsightProposalEntity.ApprovalMode.SEQUENTIAL) return true;
        Set<String> representedGroups = approvals.stream()
                .flatMap(review -> Arrays.stream(review.getActorGroups().split(",")))
                .map(this::normalizeGroup).collect(java.util.stream.Collectors.toSet());
        return Arrays.stream(proposal.getRequiredGroups().split(","))
                .map(this::normalizeGroup).allMatch(representedGroups::contains);
    }

    private void validateReviewer(InsightProposalEntity proposal, List<String> actorGroups) {
        Set<String> groups = actorGroups.stream().map(this::normalizeGroup)
                .collect(java.util.stream.Collectors.toSet());
        List<String> required = Arrays.stream(proposal.getRequiredGroups().split(","))
                .map(this::normalizeGroup).filter(value -> !value.isBlank()).toList();
        if (required.isEmpty()) return;
        if (proposal.getApprovalMode() == InsightProposalEntity.ApprovalMode.SEQUENTIAL) {
            long approvals = reviews.countByProposalIdAndDecision(
                    proposal.getId(), InsightProposalReviewEntity.Decision.APPROVE);
            String nextGroup = required.get((int) Math.min(approvals, required.size() - 1));
            if (!groups.contains(nextGroup)) {
                throw new ProcessEngineException("Reviewer does not satisfy the next approval stage");
            }
        } else if (required.stream().noneMatch(groups::contains)) {
            throw new ProcessEngineException("Reviewer does not satisfy the proposal approval policy");
        }
    }

    private String normalizeGroup(String value) {
        return value == null ? "" : value.strip().replaceFirst("^/", "").toLowerCase();
    }

    private void adoptCurrentTarget(InsightProposalEntity proposal) {
        ProcessDefinitionEntity latest = definitions
                .findFirstByProjectIdAndProcessKeyOrderByVersionDesc(
                        proposal.getProjectId(), proposal.getDefinitionKey()).orElse(null);
        if (latest == null || !latest.getDeploymentId().equals(proposal.getDefinitionDeploymentId())
                || !latest.getChecksum().equals(proposal.getTargetChecksum())) {
            proposal.setStatus(InsightProposalEntity.Status.SUPERSEDED);
            return;
        }
        byte[] source = proposal.getProposedSource().getBytes(StandardCharsets.UTF_8);
        ProcessDefinitionEntity deployed = engine.deploy(proposal.getProjectId(),
                new ByteArrayInputStream(source));
        proposal.setStatus(InsightProposalEntity.Status.ADOPTED);
        proposal.setAdoptedDeploymentId(deployed.getDeploymentId());
        proposal.setAdoptedVersion(deployed.getVersion());
    }

    public static class InsightNotFoundException extends RuntimeException {
        private final long proposalId;

        public InsightNotFoundException(long proposalId) {
            super("Insight proposal " + proposalId + " not found");
            this.proposalId = proposalId;
        }

        public long getProposalId() {
            return proposalId;
        }
    }

    public static class InsightConflictException extends RuntimeException {
        public InsightConflictException(String message) {
            super(message);
        }
    }
}
