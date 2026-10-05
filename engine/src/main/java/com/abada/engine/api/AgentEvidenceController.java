package com.abada.engine.api;

import com.abada.engine.core.agent.AgentEvidenceService;
import com.abada.engine.dto.AgentStepEvidenceDto;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** Agent evidence of an instance, and a project's evidence policy. */
@RestController
public class AgentEvidenceController {
    public record EvidencePolicyRequest(String payloads, Integer retentionDays) {}

    private final AgentEvidenceService evidence;
    private final com.abada.engine.core.IdempotencyService idempotency;

    public AgentEvidenceController(AgentEvidenceService evidence, com.abada.engine.core.IdempotencyService idempotency) {
        this.evidence = evidence;
        this.idempotency = idempotency;
    }

    /** Step summaries (digests, tokens, cost) for project viewers, operators and owners; no payloads. */
    @GetMapping("/v1/projects/{projectId}/instances/{instanceId}/agent-steps")
    public List<AgentStepEvidenceDto> steps(@PathVariable String projectId, @PathVariable String instanceId) {
        return evidence.steps(projectId, instanceId);
    }

    /** One step's evidence payloads; evidence readers of the project only, and every read is audited. */
    @GetMapping("/v1/projects/{projectId}/instances/{instanceId}/agent-steps/{stepId}/payloads")
    public ResponseEntity<AgentEvidenceService.Payloads> payloads(@PathVariable String projectId,
            @PathVariable String instanceId, @PathVariable String stepId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(evidence.payloads(projectId, instanceId, stepId));
    }

    @GetMapping("/v1/projects/{projectId}/evidence-policy")
    public AgentEvidenceService.PolicyView policy(@PathVariable String projectId) {
        return evidence.policy(projectId);
    }

    @PutMapping("/v1/projects/{projectId}/evidence-policy")
    public AgentEvidenceService.PolicyView setPolicy(@PathVariable String projectId,
            @RequestBody EvidencePolicyRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return idempotency.execute(idempotencyKey, "project.evidence-policy.set",
                Map.of("projectId", projectId, "request", request == null ? Map.of() : request),
                new com.fasterxml.jackson.core.type.TypeReference<AgentEvidenceService.PolicyView>() {},
                () -> evidence.setPolicy(projectId, request == null ? null : request.payloads(),
                        request == null ? null : request.retentionDays()));
    }
}
