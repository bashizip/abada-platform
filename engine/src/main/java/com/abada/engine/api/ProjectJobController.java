package com.abada.engine.api;

import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.IdempotencyService;
import com.abada.engine.dto.FailedJobDTO;
import com.abada.engine.dto.RetriesRequest;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.project.ProjectAccessService;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Project-scoped incident administration. */
@RestController
@RequestMapping("/v1/projects/{projectId}/jobs")
public class ProjectJobController {
    private final ExternalTaskRepository tasks;
    private final ExternalTaskCommandService commands;
    private final IdempotencyService idempotency;
    private final ProjectAccessService access;

    public ProjectJobController(ExternalTaskRepository tasks, ExternalTaskCommandService commands,
            IdempotencyService idempotency, ProjectAccessService access) {
        this.tasks = tasks;
        this.commands = commands;
        this.idempotency = idempotency;
        this.access = access;
    }

    @GetMapping
    public ResponseEntity<List<FailedJobDTO>> list(@PathVariable String projectId,
            @RequestParam(defaultValue = "true") boolean withException,
            @RequestParam(defaultValue = "true") boolean active,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        var pageable = PageRequest.of(page, Math.min(Math.max(size, 1), 100), Sort.by("id"));
        var result = tasks.findIncidentsByProject(projectId, withException, active, pageable);
        return ResponseEntity.ok().headers(Pagination.headers(result)).body(result.stream()
                .map(task -> new FailedJobDTO(task.getId(), task.getProcessInstanceId(),
                        task.getActivityId(), task.getExceptionMessage(), task.getRetries())).toList());
    }

    @PostMapping("/{jobId}/retries")
    public ResponseEntity<Void> retries(@PathVariable String projectId, @PathVariable String jobId,
            @RequestBody RetriesRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        access.require(projectId, Role.OPERATOR, Role.OWNER);
        requireJob(projectId, jobId);
        idempotency.execute(idempotencyKey, "project.external-task.retries",
                Map.of("projectId", projectId, "jobId", jobId, "retries", request.retries()), () -> {
                    commands.setRetries(jobId, request.retries());
                    return Map.of("status", "Retries updated", "jobId", jobId);
                });
        return ResponseEntity.ok().build();
    }

    @GetMapping(value = "/{jobId}/stacktrace", produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> stacktrace(@PathVariable String projectId, @PathVariable String jobId) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        String stacktrace = requireJob(projectId, jobId).getExceptionStacktrace();
        return ResponseEntity.ok(stacktrace == null || stacktrace.isEmpty()
                ? "No stack trace available for this job." : stacktrace);
    }

    private ExternalTaskEntity requireJob(String projectId, String jobId) {
        return tasks.findByIdAndProjectId(jobId, projectId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "Project job not found: " + jobId));
    }
}
