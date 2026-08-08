package com.abada.engine.api;

import com.abada.engine.context.UserContextProvider;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.core.UserStatsService;
import com.abada.engine.dto.TaskActionResponse;
import com.abada.engine.dto.TaskDetailsDto;
import com.abada.engine.dto.UserStatsDto;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.project.ProjectAccessService;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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

    public ProjectTaskController(AbadaEngine engine, UserContextProvider context,
            ProjectAccessService access, UserStatsService userStats) {
        this.engine = engine;
        this.context = context;
        this.access = access;
        this.userStats = userStats;
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
                .map(task -> TaskDetailsDto.from(task, instances.get(task.getProcessInstanceId()))).toList());
    }

    @PostMapping("/{taskId}/complete")
    public ResponseEntity<TaskActionResponse> complete(@PathVariable String projectId,
            @PathVariable String taskId, @RequestBody(required = false) Map<String, Object> variables) {
        // Archiving closes authoring and new starts, but work already in flight
        // must remain completable.
        access.require(projectId, Role.OPERATOR, Role.VIEWER);
        TaskInstance task = engine.getTaskById(taskId).orElseThrow(() -> new ApiException(
                org.springframework.http.HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                "Project task not found"));
        ProcessInstance instance = engine.getProcessInstanceById(task.getProcessInstanceId());
        if (instance == null || !projectId.equals(instance.getProjectId())) {
            throw new ApiException(org.springframework.http.HttpStatus.NOT_FOUND,
                    ApiErrorCode.RESOURCE_NOT_FOUND, "Project task not found");
        }
        engine.completeTask(taskId, context.getUsername(), context.getGroups(),
                variables == null ? Map.of() : variables);
        return ResponseEntity.ok(new TaskActionResponse("Completed", taskId));
    }
}
