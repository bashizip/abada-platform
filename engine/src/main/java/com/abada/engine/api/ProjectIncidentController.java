package com.abada.engine.api;

import com.abada.engine.dto.IncidentDTO;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.IncidentRepository;
import com.abada.engine.project.ProjectAccessService;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.GetMapping;
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

    public ProjectIncidentController(IncidentRepository incidents, ProjectAccessService access) {
        this.incidents = incidents;
        this.access = access;
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
}
