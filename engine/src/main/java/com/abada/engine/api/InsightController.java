package com.abada.engine.api;

import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.dto.InsightProposalDetailDTO;
import com.abada.engine.dto.InsightProposalSummaryDTO;
import com.abada.engine.dto.InsightReviewRequest;
import com.abada.engine.dto.PageDTO;
import com.abada.engine.insight.InsightProposalService;
import com.abada.engine.insight.InsightProposalService.InsightNotFoundException;
import com.abada.engine.persistence.entity.InsightProposalEntity;
import com.abada.engine.persistence.repository.InsightProposalRepository;
import com.abada.engine.persistence.repository.InsightProposalReviewRepository;
import com.abada.engine.persistence.entity.InsightProposalReviewEntity;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.abada.engine.project.ProjectConstants;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Insight Loop proposals: candidates produced from observation windows that
 * an auditor can review and adopt. Adoption deploys the proposed source as a
 * new immutable definition version; the underlying proposal is then marked
 * ADOPTED (or REJECTED when declined). The optimization loop never mutates a
 * running version.
 */
@RestController
@RequestMapping("/v1/insight/proposals")
public class InsightController {

    private final InsightProposalRepository proposals;
    private final InsightProposalService service;
    private final InsightProposalReviewRepository reviews;

    public InsightController(InsightProposalRepository proposals, InsightProposalService service,
            InsightProposalReviewRepository reviews) {
        this.proposals = proposals;
        this.service = service;
        this.reviews = reviews;
    }

    /** Paginated proposal list, newest first. */
    @GetMapping
    public ResponseEntity<PageDTO<InsightProposalSummaryDTO>> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String definitionKey) {
        if (page < 0 || size < 1 || size > 100) {
            throw new ProcessEngineException("page must be >= 0 and size must be between 1 and 100");
        }
        var pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        InsightProposalEntity.Status parsedStatus = null;
        if (status != null && !status.isBlank()) {
            try {
                parsedStatus = InsightProposalEntity.Status.valueOf(status.toUpperCase());
            } catch (IllegalArgumentException exception) {
                throw new ProcessEngineException("Unknown proposal status: " + status);
            }
        }
        Page<InsightProposalEntity> result;
        if (parsedStatus != null && definitionKey != null && !definitionKey.isBlank()) {
            result = proposals.findByProjectIdAndStatusAndDefinitionKey(
                    ProjectConstants.DEFAULT_PROJECT_ID, parsedStatus, definitionKey, pageable);
        } else if (parsedStatus != null) {
            result = proposals.findByProjectIdAndStatus(
                    ProjectConstants.DEFAULT_PROJECT_ID, parsedStatus, pageable);
        } else if (definitionKey != null && !definitionKey.isBlank()) {
            result = proposals.findByProjectIdAndDefinitionKey(
                    ProjectConstants.DEFAULT_PROJECT_ID, definitionKey, pageable);
        } else {
            result = proposals.findByProjectId(ProjectConstants.DEFAULT_PROJECT_ID, pageable);
        }
        return ResponseEntity.ok(PageDTO.map(result, InsightProposalSummaryDTO::from));
    }

    /** Full proposal with the sources that an adoption review needs. */
    @GetMapping("/{proposalId}")
    public ResponseEntity<InsightProposalDetailDTO> detail(@PathVariable long proposalId) {
        InsightProposalEntity proposal = proposals.findByIdAndProjectId(
                        proposalId, ProjectConstants.DEFAULT_PROJECT_ID)
                .orElseThrow(() -> new InsightNotFoundException(proposalId));
        return ResponseEntity.ok(InsightProposalDetailDTO.from(proposal,
                reviews.findByProposalIdOrderByCreatedAtAsc(proposalId)));
    }

    @PostMapping("/{proposalId}/reviews")
    public ResponseEntity<InsightProposalDetailDTO> review(@PathVariable long proposalId,
            @org.springframework.web.bind.annotation.RequestBody InsightReviewRequest request) {
        if (request == null || request.decision() == null) {
            throw new ProcessEngineException("Review decision is required");
        }
        InsightProposalReviewEntity.Decision decision;
        try {
            decision = InsightProposalReviewEntity.Decision.valueOf(request.decision().toUpperCase());
        } catch (IllegalArgumentException exception) {
            throw new ProcessEngineException("Review decision must be APPROVE or REJECT");
        }
        Identity identity = IdentityContext.get().orElse(new Identity("anonymous", List.of()));
        InsightProposalEntity proposal = service.review(proposalId, identity.username(), identity.groups(),
                decision, request.comment(), request.expectedUpdatedAt());
        return ResponseEntity.ok(InsightProposalDetailDTO.from(proposal,
                reviews.findByProposalIdOrderByCreatedAtAsc(proposalId)));
    }

}
