package com.abada.engine.api;

import com.abada.engine.dto.InsightApprovalPolicyDTO;
import com.abada.engine.insight.InsightPolicyService;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/insight/policies")
public class InsightPolicyController {
    public record UpdatePolicyRequest(long expectedVersion, int requiredApprovals,
            String requiredGroups, String approvalMode) {}

    private final InsightPolicyService policies;

    public InsightPolicyController(InsightPolicyService policies) { this.policies = policies; }

    @GetMapping("/{definitionKey}")
    public ResponseEntity<InsightApprovalPolicyDTO> get(@PathVariable String definitionKey) {
        return ResponseEntity.ok(InsightApprovalPolicyDTO.from(policies.get(definitionKey)));
    }

    @PutMapping("/{definitionKey}")
    public ResponseEntity<InsightApprovalPolicyDTO> update(@PathVariable String definitionKey,
            @RequestBody UpdatePolicyRequest request) {
        String actor = IdentityContext.get().map(Identity::username).orElse("anonymous");
        return ResponseEntity.ok(InsightApprovalPolicyDTO.from(policies.update(definitionKey,
                request.expectedVersion(), request.requiredApprovals(), request.requiredGroups(),
                request.approvalMode(), actor)));
    }
}
