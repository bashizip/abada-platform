package com.abada.engine.api;

import com.abada.engine.dto.IncidentDTO;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.IncidentRepository;
import com.abada.engine.project.ProjectAccessService;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.IdempotencyService;
import java.util.Map;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Project-scoped runtime incidents, newest first. */
@RestController
@RequestMapping("/v1/projects/{projectId}/incidents")
public class ProjectIncidentController {
    private final IncidentRepository incidents;
    private final ProjectAccessService access;
    private final AbadaEngine engine;
    private final IdempotencyService idempotency;

    public ProjectIncidentController(IncidentRepository incidents, ProjectAccessService access, AbadaEngine engine,
            IdempotencyService idempotency) {
        this.incidents = incidents;
        this.access = access;
        this.engine = engine;
        this.idempotency = idempotency;
    }

    @GetMapping
    public List<IncidentDTO> list(@PathVariable String projectId,
            @RequestParam(defaultValue = "true") boolean open,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        var pageable = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 100));
        var result = open
                ? incidents.findByProjectIdAndResolvedAtIsNullOrderByCreatedAtDesc(projectId, pageable)
                : incidents.findByProjectIdOrderByCreatedAtDesc(projectId, pageable);
        return result.stream().map(IncidentDTO::from).toList();
    }

    /** Restarts the token an open incident stopped; project operators and owners only. */
    @PostMapping("/{incidentId}/retry")
    public ResponseEntity<Void> retry(@PathVariable String projectId, @PathVariable String incidentId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        access.require(projectId, Role.OPERATOR, Role.OWNER);
        var incident = incidents.findById(incidentId).filter(found -> found.getProjectId().equals(projectId))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "Incident not found: " + incidentId));
        idempotency.execute(idempotencyKey, "project.incident.retry",
                Map.of("projectId", projectId, "incidentId", incidentId), () -> {
                    engine.retryIncident(incident.getProcessInstanceId(), incidentId);
                    return Map.of("status", "Retried", "incidentId", incidentId);
                });
        return ResponseEntity.noContent().build();
    }
}
