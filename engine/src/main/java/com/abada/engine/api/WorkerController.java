package com.abada.engine.api;

import com.abada.engine.dto.WorkerHealthDTO;
import com.abada.engine.dto.WorkerRegistrationRequest;
import com.abada.engine.dto.WorkerRegistrationResponse;
import com.abada.engine.persistence.entity.WorkerCapabilityEntity;
import com.abada.engine.project.WorkerCapabilityService;
import com.abada.engine.project.WorkerHealthService;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * First-class worker management surface. Workers self-register their global
 * capabilities once at startup ({@code PUT /v1/workers/me}) and then poll
 * {@code /v1/external-tasks/fetch-and-lock} without a projectId. Operations
 * reads global worker health and registration state from
 * {@code GET /v1/workers/health}.
 */
@RestController
@RequestMapping("/v1/workers")
public class WorkerController {

    private final WorkerCapabilityService workerCapabilities;
    private final WorkerHealthService workerHealth;

    public WorkerController(WorkerCapabilityService workerCapabilities, WorkerHealthService workerHealth) {
        this.workerCapabilities = workerCapabilities;
        this.workerHealth = workerHealth;
    }

    /**
     * Registers (upserts) the calling worker's global capabilities for the
     * requested topics and models. Requires the Abada worker role and a
     * service principal.
     */
    @PutMapping("/me")
    public WorkerRegistrationResponse register(@RequestBody WorkerRegistrationRequest request) {
        List<WorkerCapabilityEntity> capabilities = workerCapabilities.register(request.topics(), request.models());
        return toResponse(capabilities);
    }

    /** Returns the calling worker's registered capabilities. */
    @GetMapping("/me")
    public WorkerRegistrationResponse me() {
        return toResponse(workerCapabilities.capabilitiesForCurrentWorker());
    }

    /**
     * Global worker health: registered capabilities plus recent liveness rows
     * for every global worker, whether it is bound, online, or failing.
     */
    @GetMapping("/health")
    public ResponseEntity<List<WorkerHealthDTO>> globalHealth() {
        return ResponseEntity.ok(workerHealth.globalHealth());
    }

    private static WorkerRegistrationResponse toResponse(List<WorkerCapabilityEntity> capabilities) {
        if (capabilities.isEmpty()) {
            return new WorkerRegistrationResponse(null, null, List.of(), null);
        }
        WorkerCapabilityEntity first = capabilities.get(0);
        return new WorkerRegistrationResponse(first.getPrincipalId(), first.getCreatedBy(),
                capabilities.stream().map(capability -> new WorkerRegistrationResponse.RegisteredCapability(
                        capability.getTopic(), modelsOf(capability))).toList(),
                first.getCreatedAt());
    }

    private static List<String> modelsOf(WorkerCapabilityEntity capability) {
        if (capability.getModels() == null || capability.getModels().isBlank()) return List.of();
        return List.of(capability.getModels().split(","));
    }
}
