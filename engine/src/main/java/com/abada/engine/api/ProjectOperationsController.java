package com.abada.engine.api;

import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.IdempotencyService;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.dto.ActivityHistoryDto;
import com.abada.engine.dto.ActivityInstanceTree;
import com.abada.engine.dto.CancelRequest;
import com.abada.engine.dto.ChildActivityInstance;
import com.abada.engine.dto.SuspensionRequest;
import com.abada.engine.dto.VariablePatchRequest;
import com.abada.engine.dto.VariableValue;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.project.ProjectAccessService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Project-scoped operational commands and process-state inspection. */
@RestController
@RequestMapping("/v1/projects/{projectId}/instances/{instanceId}")
public class ProjectOperationsController {
    private final AbadaEngine engine;
    private final ActivityHistoryRepository history;
    private final IdempotencyService idempotency;
    private final ObjectMapper objectMapper;
    private final ProjectAccessService access;

    public ProjectOperationsController(AbadaEngine engine, ActivityHistoryRepository history,
            IdempotencyService idempotency, ObjectMapper objectMapper, ProjectAccessService access) {
        this.engine = engine;
        this.history = history;
        this.idempotency = idempotency;
        this.objectMapper = objectMapper;
        this.access = access;
    }

    @GetMapping("/variables")
    public ResponseEntity<Map<String, VariableValue>> variables(@PathVariable String projectId,
            @PathVariable String instanceId) {
        ProcessInstance instance = requireInstance(projectId, instanceId, false);
        return ResponseEntity.ok(instance.getVariables().entrySet().stream().collect(Collectors.toMap(
                Map.Entry::getKey, entry -> VariableValue.from(entry.getValue()))));
    }

    @PatchMapping("/variables")
    public ResponseEntity<Void> patchVariables(@PathVariable String projectId,
            @PathVariable String instanceId, @RequestBody VariablePatchRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        requireInstance(projectId, instanceId, true);
        Map<String, Object> modifications = request.modifications().entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, entry -> entry.getValue().toObject()));
        idempotency.execute(idempotencyKey, "project.process.variables.patch",
                Map.of("projectId", projectId, "instanceId", instanceId, "modifications", modifications), () -> {
                    engine.updateProcessVariables(instanceId, modifications);
                    return Map.of("status", "Updated", "processInstanceId", instanceId);
                });
        return ResponseEntity.ok().build();
    }

    @DeleteMapping
    public ResponseEntity<Void> cancel(@PathVariable String projectId, @PathVariable String instanceId,
            @RequestBody(required = false) CancelRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        requireInstance(projectId, instanceId, true);
        String reason = request != null && request.reason() != null ? request.reason() : "Cancelled via API";
        idempotency.execute(idempotencyKey, "project.process.cancel",
                Map.of("projectId", projectId, "instanceId", instanceId, "reason", reason), () -> {
                    engine.cancelProcessInstance(instanceId, reason);
                    return Map.of("status", "Cancelled", "processInstanceId", instanceId);
                });
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/suspension")
    public ResponseEntity<Void> suspension(@PathVariable String projectId, @PathVariable String instanceId,
            @RequestBody SuspensionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        requireInstance(projectId, instanceId, true);
        idempotency.execute(idempotencyKey, "project.process.suspension",
                Map.of("projectId", projectId, "instanceId", instanceId,
                        "suspended", request.suspended()), () -> {
                    engine.suspendProcessInstance(instanceId, request.suspended());
                    return Map.of("status", request.suspended() ? "Suspended" : "Active",
                            "processInstanceId", instanceId);
                });
        return ResponseEntity.ok().build();
    }

    @GetMapping("/activity-instances")
    public ResponseEntity<ActivityInstanceTree> activities(@PathVariable String projectId,
            @PathVariable String instanceId) {
        ProcessInstance instance = requireInstance(projectId, instanceId, false);
        List<ChildActivityInstance> children = instance.getActiveTokens().stream()
                .map(activityId -> new ChildActivityInstance(activityId,
                        instance.getDefinition().getActivityName(activityId), "exec-" + instanceId))
                .toList();
        return ResponseEntity.ok(new ActivityInstanceTree(instanceId, children));
    }

    @GetMapping("/history")
    public ResponseEntity<List<ActivityHistoryDto>> history(@PathVariable String projectId,
            @PathVariable String instanceId, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        requireInstance(projectId, instanceId, false);
        var pageable = PageRequest.of(page, Math.min(Math.max(size, 1), 100),
                Sort.by("occurredAt").ascending().and(Sort.by("id").ascending()));
        var result = history.findByProcessInstanceId(instanceId, pageable);
        return ResponseEntity.ok().headers(Pagination.headers(result))
                .body(result.stream().map(item -> ActivityHistoryDto.from(item, objectMapper)).toList());
    }

    private ProcessInstance requireInstance(String projectId, String instanceId, boolean mutation) {
        if (mutation) access.require(projectId, Role.OPERATOR, Role.OWNER);
        else access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        ProcessInstance instance = engine.getProcessInstanceById(instanceId);
        if (instance == null || !projectId.equals(instance.getProjectId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                    "Project process instance not found");
        }
        return instance;
    }
}
