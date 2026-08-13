package com.abada.engine.api;

import com.abada.engine.dto.WorkerHealthDTO;
import com.abada.engine.project.WorkerHealthService;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Operational liveness surface for external workers in a project: which
 * worker principals are bound to which topics, whether they are currently
 * reachable, and the recent rejection incidents (message, time, consecutive
 * failures) that would otherwise only appear in worker container logs.
 */
@RestController
@RequestMapping("/v1/projects")
public class ProjectWorkerHealthController {

    private final WorkerHealthService health;

    public ProjectWorkerHealthController(WorkerHealthService health) {
        this.health = health;
    }

    @GetMapping("/{projectId}/workers/health")
    public ResponseEntity<List<WorkerHealthDTO>> workersHealth(@PathVariable String projectId) {
        return ResponseEntity.ok(health.healthForProject(projectId));
    }
}