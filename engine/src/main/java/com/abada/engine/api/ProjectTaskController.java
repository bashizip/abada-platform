package com.abada.engine.api;

import com.abada.engine.context.UserContextProvider;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.IdempotencyService;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.core.UserStatsService;
import com.abada.engine.dto.TaskActionResponse;
import com.abada.engine.dto.TaskDetailsDto;
import com.abada.engine.dto.UserStatsDto;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.project.ProjectAccessService;
import com.fasterxml.jackson.core.type.TypeReference;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/projects/{projectId}/tasks")
public class ProjectTaskController {
    private final AbadaEngine engine;
    private final UserContextProvider context;
    private final ProjectAccessService access;
    private final UserStatsService userStats;
    private final IdempotencyService idempotencyService;

    public ProjectTaskController(AbadaEngine engine, UserContextProvider context,
            ProjectAccessService access, UserStatsService userStats,
            IdempotencyService idempotencyService) {
        this.engine = engine;
        this.context = context;
        this.access = access;
        this.userStats = userStats;
        this.idempotencyService = idempotencyService;
    }

    @GetMapping("/user-stats")
    public ResponseEntity<UserStatsDto> stats(@PathVariable String projectId) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        return ResponseEntity.ok(userStats.getUserStats(projectId,
                context.getUsername(), context.getGroups()));
    }

    @GetMapping
    public ResponseEntity<List<TaskDetailsDto>> list(@PathVariable String projectId,
            @RequestParam(required = false) TaskStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        var pageable = Pagination.request(page, size,
                Sort.by("startDate").ascending().and(Sort.by("id").ascending()));
        var visible = engine.getTaskManager().getVisibleTasksForUser(projectId,
                context.getUsername(), context.getGroups(), status, pageable);
        Set<String> ids = visible.stream().map(TaskInstance::getProcessInstanceId)
                .collect(Collectors.toSet());
        Map<String, ProcessInstance> instances = engine.getProcessInstancesByIds(ids);
        return ResponseEntity.ok().headers(Pagination.headers(visible)).body(visible.stream()
                .map(task -> TaskDetailsDto.from(task, instances.get(task.getProcessInstanceId())))
                .toList());
    }

    @GetMapping("/{taskId}")
    public ResponseEntity<TaskDetailsDto> detail(@PathVariable String projectId,
            @PathVariable String taskId) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        return ResponseEntity.ok(toDetails(requireVisible(projectId, taskId)));
    }

    @PostMapping("/{taskId}/claim")
    public ResponseEntity<TaskActionResponse> claim(@PathVariable String projectId,
            @PathVariable String taskId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        requireInProject(projectId, taskId);
        return ResponseEntity.ok(idempotencyService.execute(idempotencyKey, "task.claim",
                Map.of("taskId", taskId, "user", context.getUsername()),
                new TypeReference<TaskActionResponse>() {}, () -> {
                    engine.claim(taskId, context.getUsername(), context.getGroups());
                    return new TaskActionResponse("Claimed", taskId);
                }));
    }

    @PostMapping("/{taskId}/unclaim")
    public ResponseEntity<TaskActionResponse> unclaim(@PathVariable String projectId,
            @PathVariable String taskId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        requireInProject(projectId, taskId);
        return ResponseEntity.ok(idempotencyService.execute(idempotencyKey, "task.unclaim",
                Map.of("taskId", taskId, "user", context.getUsername()),
                new TypeReference<TaskActionResponse>() {}, () -> {
                    engine.unclaim(taskId, context.getUsername());
                    return new TaskActionResponse("Unclaimed", taskId);
                }));
    }

    @PostMapping("/{taskId}/fail")
    public ResponseEntity<TaskActionResponse> fail(@PathVariable String projectId,
            @PathVariable String taskId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        requireVisible(projectId, taskId);
        return ResponseEntity.ok(idempotencyService.execute(idempotencyKey, "task.fail",
                Map.of("taskId", taskId), new TypeReference<TaskActionResponse>() {}, () -> {
                    engine.failTask(taskId);
                    return new TaskActionResponse("Failed", taskId);
                }));
    }

    @PostMapping("/{taskId}/complete")
    public ResponseEntity<TaskActionResponse> complete(@PathVariable String projectId,
            @PathVariable String taskId, @RequestBody(required = false) Map<String, Object> variables,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        // Archiving closes authoring and new starts, but work already in flight
        // must remain completable.
        access.require(projectId, Role.OPERATOR, Role.VIEWER);
        requireInProject(projectId, taskId);
        Map<String, Object> body = variables == null ? Map.of() : variables;
        return ResponseEntity.ok(idempotencyService.execute(idempotencyKey, "task.complete",
                Map.of("taskId", taskId, "user", context.getUsername(), "variables", body),
                new TypeReference<TaskActionResponse>() {}, () -> {
                    engine.completeTask(taskId, context.getUsername(), context.getGroups(), body);
                    return new TaskActionResponse("Completed", taskId);
                }));
    }

    private TaskInstance requireInProject(String projectId, String taskId) {
        TaskInstance task = engine.getTaskById(taskId).orElseThrow(() -> new ApiException(
                HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "Project task not found"));
        ProcessInstance instance = engine.getProcessInstanceById(task.getProcessInstanceId());
        if (instance == null || !projectId.equals(instance.getProjectId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                    "Project task not found");
        }
        return task;
    }

    private TaskInstance requireVisible(String projectId, String taskId) {
        TaskInstance task = requireInProject(projectId, taskId);
        String user = context.getUsername();
        List<String> groups = context.getGroups();
        boolean assigned = user != null && user.equals(task.getAssignee());
        boolean candidate = task.getAssignee() == null && (task.getCandidateUsers().contains(user)
                || (groups != null && groups.stream().anyMatch(task.getCandidateGroups()::contains)));
        if (!assigned && !candidate) {
            throw new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                    "User is not authorized to access task " + task.getId());
        }
        return task;
    }

    private TaskDetailsDto toDetails(TaskInstance task) {
        ProcessInstance instance = engine.getProcessInstanceById(task.getProcessInstanceId());
        return TaskDetailsDto.from(task, instance);
    }
}
