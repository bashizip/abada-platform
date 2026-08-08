package com.abada.engine.api;

import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.dto.InsightApprovalPolicyDTO;
import com.abada.engine.dto.InsightProposalDetailDTO;
import com.abada.engine.dto.InsightProposalSummaryDTO;
import com.abada.engine.dto.InsightReviewRequest;
import com.abada.engine.dto.PageDTO;
import com.abada.engine.insight.InsightPolicyService;
import com.abada.engine.insight.InsightProposalService;
import com.abada.engine.insight.InsightProposalService.InsightNotFoundException;
import com.abada.engine.persistence.entity.InsightProposalEntity;
import com.abada.engine.persistence.entity.InsightProposalReviewEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.InsightProposalRepository;
import com.abada.engine.persistence.repository.InsightProposalReviewRepository;
import com.abada.engine.project.ProjectAccessService;
import com.abada.engine.security.Identity;
import java.util.ArrayList;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Project-scoped governance surface. Legacy /v1/insight routes remain Default-project aliases. */
@RestController
@RequestMapping("/v1/projects/{projectId}/insight")
public class ProjectInsightController {
    public record UpdatePolicyRequest(long expectedVersion, int requiredApprovals,
                                      List<String> requiredLanes, String approvalMode) {}

    private final InsightProposalRepository proposals;
    private final InsightProposalReviewRepository reviews;
    private final InsightProposalService proposalService;
    private final InsightPolicyService policyService;
    private final ProjectAccessService access;

    public ProjectInsightController(InsightProposalRepository proposals,
            InsightProposalReviewRepository reviews, InsightProposalService proposalService,
            InsightPolicyService policyService, ProjectAccessService access) {
        this.proposals = proposals;
        this.reviews = reviews;
        this.proposalService = proposalService;
        this.policyService = policyService;
        this.access = access;
    }

    @GetMapping("/proposals")
    public ResponseEntity<PageDTO<InsightProposalSummaryDTO>> list(@PathVariable String projectId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String definitionKey) {
        access.requireVisible(projectId);
        if (page < 0 || size < 1 || size > 100) {
            throw new ProcessEngineException("page must be >= 0 and size must be between 1 and 100");
        }
        var pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        InsightProposalEntity.Status parsedStatus = parseStatus(status);
        Page<InsightProposalEntity> result;
        if (parsedStatus != null && hasText(definitionKey)) {
            result = proposals.findByProjectIdAndStatusAndDefinitionKey(
                    projectId, parsedStatus, definitionKey, pageable);
        } else if (parsedStatus != null) {
            result = proposals.findByProjectIdAndStatus(projectId, parsedStatus, pageable);
        } else if (hasText(definitionKey)) {
            result = proposals.findByProjectIdAndDefinitionKey(projectId, definitionKey, pageable);
        } else {
            result = proposals.findByProjectId(projectId, pageable);
        }
        return ResponseEntity.ok(PageDTO.map(result, InsightProposalSummaryDTO::from));
    }

    @GetMapping("/proposals/{proposalId}")
    public ResponseEntity<InsightProposalDetailDTO> detail(@PathVariable String projectId,
            @PathVariable long proposalId) {
        access.requireVisible(projectId);
        InsightProposalEntity proposal = proposals.findByIdAndProjectId(proposalId, projectId)
                .orElseThrow(() -> new InsightNotFoundException(proposalId));
        return ResponseEntity.ok(InsightProposalDetailDTO.from(proposal,
                reviews.findByProposalIdOrderByCreatedAtAsc(proposalId)));
    }

    @PostMapping("/proposals/{proposalId}/reviews")
    public ResponseEntity<InsightProposalDetailDTO> review(@PathVariable String projectId,
            @PathVariable long proposalId, @RequestBody InsightReviewRequest request) {
        access.requireActive(projectId, Role.REVIEWER);
        // Global administration deliberately cannot manufacture a business approval.
        var membership = access.membership(projectId);
        if (membership == null || !membership.getRoles().contains(Role.REVIEWER)) {
            throw new ProcessEngineException("A project reviewer membership is required");
        }
        if (request == null || request.decision() == null) {
            throw new ProcessEngineException("Review decision is required");
        }
        InsightProposalReviewEntity.Decision decision;
        try {
            decision = InsightProposalReviewEntity.Decision.valueOf(request.decision().toUpperCase());
        } catch (IllegalArgumentException exception) {
            throw new ProcessEngineException("Review decision must be APPROVE or REJECT");
        }
        Identity identity = access.identity();
        List<String> selectors = new ArrayList<>(identity.groups());
        membership.getReviewLanes().forEach(lane -> selectors.add("lane:" + lane));
        InsightProposalEntity proposal = proposalService.review(projectId, proposalId,
                identity.username(), selectors, decision, request.comment(), request.expectedUpdatedAt());
        return ResponseEntity.ok(InsightProposalDetailDTO.from(proposal,
                reviews.findByProposalIdOrderByCreatedAtAsc(proposalId)));
    }

    @GetMapping("/policies/{definitionKey}")
    public ResponseEntity<InsightApprovalPolicyDTO> policy(@PathVariable String projectId,
            @PathVariable String definitionKey) {
        access.requireVisible(projectId);
        return ResponseEntity.ok(InsightApprovalPolicyDTO.from(policyService.get(projectId, definitionKey)));
    }

    @PutMapping("/policies/{definitionKey}")
    public ResponseEntity<InsightApprovalPolicyDTO> updatePolicy(@PathVariable String projectId,
            @PathVariable String definitionKey, @RequestBody UpdatePolicyRequest request) {
        access.requireActive(projectId, Role.OWNER, Role.MAINTAINER);
        List<String> lanes = request.requiredLanes() == null ? List.of() : request.requiredLanes();
        String selectors = lanes.stream().map(access::normalizeLane).distinct()
                .map(lane -> "lane:" + lane).collect(java.util.stream.Collectors.joining(","));
        return ResponseEntity.ok(InsightApprovalPolicyDTO.from(policyService.update(projectId,
                definitionKey, request.expectedVersion(), request.requiredApprovals(), selectors,
                request.approvalMode(), access.identity().username())));
    }

    private InsightProposalEntity.Status parseStatus(String status) {
        if (!hasText(status)) return null;
        try {
            return InsightProposalEntity.Status.valueOf(status.toUpperCase());
        } catch (IllegalArgumentException exception) {
            throw new ProcessEngineException("Unknown proposal status: " + status);
        }
    }

    private boolean hasText(String value) { return value != null && !value.isBlank(); }
}
