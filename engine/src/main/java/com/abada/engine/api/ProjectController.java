package com.abada.engine.api;

import com.abada.engine.dto.PrincipalDTO;
import com.abada.engine.dto.ProjectDTO;
import com.abada.engine.dto.ProjectMemberDTO;
import com.abada.engine.persistence.entity.ProjectEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.project.ProjectAccessService;
import com.abada.engine.project.ProjectService;
import com.abada.engine.project.ProjectWorkerService;
import java.util.List;
import java.util.Set;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/projects")
public class ProjectController {
    public record CreateProjectRequest(String slug, String name, String description) {}
    public record UpdateProjectRequest(long expectedVersion, String name, String description) {}
    public record ArchiveProjectRequest(long expectedVersion, boolean archived) {}
    public record PutMemberRequest(Long expectedVersion, Set<Role> roles, Set<String> reviewLanes) {}
    public record PutWorkerBindingRequest(List<String> topics) {}
    public record WorkerBindingDTO(String principalId, List<String> topics, long version) {}

    private final ProjectService service;
    private final ProjectAccessService access;
    private final PrincipalRepository principals;
    private final ProjectWorkerService workers;

    public ProjectController(ProjectService service, ProjectAccessService access,
            PrincipalRepository principals, ProjectWorkerService workers) {
        this.service = service;
        this.access = access;
        this.principals = principals;
        this.workers = workers;
    }

    @PostMapping
    public ResponseEntity<ProjectDTO> create(@RequestBody CreateProjectRequest request) {
        return ResponseEntity.ok(toDto(service.create(request.slug(), request.name(), request.description())));
    }

    @GetMapping
    public ResponseEntity<List<ProjectDTO>> list() {
        return ResponseEntity.ok(service.accessibleProjects().stream().map(this::toDto).toList());
    }

    @GetMapping("/{projectId}")
    public ResponseEntity<ProjectDTO> get(@PathVariable String projectId) {
        return ResponseEntity.ok(toDto(access.requireVisible(projectId)));
    }

    @PutMapping("/{projectId}")
    public ResponseEntity<ProjectDTO> update(@PathVariable String projectId,
            @RequestBody UpdateProjectRequest request) {
        return ResponseEntity.ok(toDto(service.update(projectId, request.expectedVersion(),
                request.name(), request.description())));
    }

    @PostMapping("/{projectId}/archive")
    public ResponseEntity<ProjectDTO> archive(@PathVariable String projectId,
            @RequestBody ArchiveProjectRequest request) {
        return ResponseEntity.ok(toDto(service.setArchived(projectId, request.expectedVersion(),
                request.archived())));
    }

    @GetMapping("/{projectId}/members")
    public ResponseEntity<List<ProjectMemberDTO>> members(@PathVariable String projectId) {
        return ResponseEntity.ok(service.members(projectId).stream().map(this::memberDto).toList());
    }

    @PutMapping("/{projectId}/members/{principalId}")
    public ResponseEntity<ProjectMemberDTO> putMember(@PathVariable String projectId,
            @PathVariable String principalId, @RequestBody PutMemberRequest request) {
        return ResponseEntity.ok(memberDto(service.putMember(projectId, principalId,
                request.expectedVersion(), request.roles(), request.reviewLanes())));
    }

    @DeleteMapping("/{projectId}/members/{principalId}")
    public ResponseEntity<Void> removeMember(@PathVariable String projectId,
            @PathVariable String principalId) {
        service.removeMember(projectId, principalId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{projectId}/principals")
    public ResponseEntity<List<PrincipalDTO>> principals(@PathVariable String projectId,
            @RequestParam(defaultValue = "") String query,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        access.require(projectId, Role.OWNER);
        var pageable = PageRequest.of(page, Math.min(Math.max(size, 1), 100),
                Sort.by("username").ascending());
        return ResponseEntity.ok(service.searchPrincipals(query, pageable).stream()
                .map(PrincipalDTO::from).toList());
    }

    @GetMapping("/{projectId}/workers")
    public ResponseEntity<List<WorkerBindingDTO>> workers(@PathVariable String projectId) {
        return ResponseEntity.ok(workers.list(projectId).stream().map(binding ->
                new WorkerBindingDTO(binding.getPrincipalId(),
                        java.util.Arrays.stream(binding.getTopics().split(",")).toList(),
                        binding.getEntityVersion())).toList());
    }

    @PutMapping("/{projectId}/workers/{principalId}")
    public ResponseEntity<WorkerBindingDTO> putWorker(@PathVariable String projectId,
            @PathVariable String principalId, @RequestBody PutWorkerBindingRequest request) {
        var binding = workers.put(projectId, principalId, request.topics());
        return ResponseEntity.ok(new WorkerBindingDTO(binding.getPrincipalId(),
                java.util.Arrays.stream(binding.getTopics().split(",")).toList(),
                binding.getEntityVersion()));
    }

    private ProjectDTO toDto(ProjectEntity project) {
        ProjectMemberEntity membership = access.membership(project.getId());
        return new ProjectDTO(project.getId(), project.getSlug(), project.getName(),
                project.getDescription(), project.getStatus().name(), project.getEntityVersion(),
                project.getCreatedAt(), project.getUpdatedAt(), service.processCount(project.getId()),
                membership == null ? Set.of() : Set.copyOf(membership.getRoles()),
                membership == null ? Set.of() : Set.copyOf(membership.getReviewLanes()));
    }

    private ProjectMemberDTO memberDto(ProjectMemberEntity member) {
        return ProjectMemberDTO.from(member, principals.findById(member.getPrincipalId()).orElseThrow());
    }
}
