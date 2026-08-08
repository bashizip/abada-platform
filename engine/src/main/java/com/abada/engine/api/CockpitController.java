package com.abada.engine.api;

import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.IdempotencyService;
import com.abada.engine.dto.VariablePatchRequest;
import com.abada.engine.dto.VariableValue;
import com.abada.engine.dto.CancelRequest;
import com.abada.engine.dto.SuspensionRequest;
import com.abada.engine.dto.ActivityInstanceTree;
import com.abada.engine.dto.ActivityHistoryDto;
import com.abada.engine.dto.ChildActivityInstance;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.project.ProjectConstants;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * REST controller for Operations Cockpit (Orun) endpoints.
 * Provides endpoints for managing process instances, variables, and activity
 * visualization.
 */
@RestController
@RequestMapping("/v1/process-instances")
public class CockpitController {

    private final AbadaEngine engine;
    private final ActivityHistoryRepository historyRepository;
    private final IdempotencyService idempotency;
    private final ObjectMapper objectMapper;

    public CockpitController(AbadaEngine engine, ActivityHistoryRepository historyRepository,
            IdempotencyService idempotency, ObjectMapper objectMapper) {
        this.engine = engine;
        this.historyRepository = historyRepository;
        this.idempotency = idempotency;
        this.objectMapper = objectMapper;
    }

    /**
     * Gets all variables for a specific process instance.
     * Used by Orun for the "Data Surgery" feature to view current state.
     *
     * @param instanceId The ID of the process instance.
     * @return A map of variable names to their typed values.
     */
    @GetMapping("/{instanceId}/variables")
    public ResponseEntity<Map<String, VariableValue>> getProcessVariables(@PathVariable String instanceId) {
        ProcessInstance instance = requireInstance(instanceId);

        Map<String, VariableValue> typedVariables = instance.getVariables().entrySet().stream()
                .collect(Collectors.toMap(
                        Map.Entry::getKey,
                        entry -> VariableValue.from(entry.getValue())));

        return ResponseEntity.ok(typedVariables);
    }

    /**
     * Modifies variables for a specific process instance.
     * Used by Orun for the "Data Surgery" feature to fix incorrect state.
     *
     * @param instanceId The ID of the process instance.
     * @param request    The variable modifications to apply.
     * @return Empty response on success.
     */
    @PatchMapping("/{instanceId}/variables")
    public ResponseEntity<Void> patchProcessVariables(
            @PathVariable String instanceId,
            @RequestBody VariablePatchRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {

        requireInstance(instanceId);

        // Apply the variable modifications
        Map<String, Object> modifications = request.modifications().entrySet().stream()
                .collect(Collectors.toMap(
                        Map.Entry::getKey,
                        entry -> entry.getValue().toObject()));

        idempotency.execute(idempotencyKey, "process.variables.patch",
                Map.of("instanceId", instanceId, "modifications", modifications), () -> {
                    engine.updateProcessVariables(instanceId, modifications);
                    return Map.of("status", "Updated", "processInstanceId", instanceId);
                });

        return ResponseEntity.ok().build();
    }

    /**
     * Cancels a running process instance.
     * The instance status will be set to CANCELLED and execution will stop.
     *
     * @param id      The ID of the process instance.
     * @param request Optional request body containing the cancellation reason.
     * @return Empty response on success.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> cancelProcess(@PathVariable String id,
            @RequestBody(required = false) CancelRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        String reason = request != null && request.reason() != null ? request.reason() : "Cancelled via API";
        requireInstance(id);
        idempotency.execute(idempotencyKey, "process.cancel", Map.of("id", id, "reason", reason), () -> {
            engine.cancelProcessInstance(id, reason);
            return Map.of("status", "Cancelled", "processInstanceId", id);
        });
        return ResponseEntity.noContent().build();
    }

    /**
     * Suspends or activates a process instance.
     * A suspended process cannot advance or complete tasks.
     *
     * @param id      The ID of the process instance.
     * @param request The suspension request containing the new state.
     * @return Empty response on success.
     */
    @PutMapping("/{id}/suspension")
    public ResponseEntity<Void> setSuspension(@PathVariable String id,
            @RequestBody SuspensionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        requireInstance(id);
        idempotency.execute(idempotencyKey, "process.suspension",
                Map.of("id", id, "suspended", request.suspended()), () -> {
                    engine.suspendProcessInstance(id, request.suspended());
                    return Map.of("status", request.suspended() ? "Suspended" : "Active",
                            "processInstanceId", id);
                });
        return ResponseEntity.ok().build();
    }

    /**
     * Retrieves the active activity instances for a process instance.
     * Used by Orun for visual BPMN highlighting.
     *
     * @param id The ID of the process instance.
     * @return The activity instance tree containing active tokens.
     */
    @GetMapping("/{id}/activity-instances")
    public ResponseEntity<ActivityInstanceTree> getActivityInstances(@PathVariable String id) {
        ProcessInstance instance = requireInstance(id);

        List<ChildActivityInstance> children = instance.getActiveTokens().stream()
                .map(activityId -> {
                    String name = instance.getDefinition().getActivityName(activityId);
                    return new ChildActivityInstance(
                            activityId,
                            name,
                            "exec-" + id // Simplified execution ID
                    );
                })
                .collect(Collectors.toList());

        return ResponseEntity.ok(new ActivityInstanceTree(id, children));
    }

    @GetMapping("/{id}/history")
    public ResponseEntity<List<ActivityHistoryDto>> getHistory(@PathVariable String id,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = Pagination.DEFAULT_PAGE_SIZE) int size) {
        requireInstance(id);
        Pageable pageable = Pagination.request(page, size,
                Sort.by("occurredAt").ascending().and(Sort.by("id").ascending()));
        Page<ActivityHistoryEntity> history = historyRepository.findByProcessInstanceId(id, pageable);
        return ResponseEntity.ok().headers(Pagination.headers(history))
                .body(history.stream().map(entity -> ActivityHistoryDto.from(entity, objectMapper)).toList());
    }

    private ProcessInstance requireInstance(String id) {
        ProcessInstance instance = engine.getProcessInstanceById(id);
        if (instance == null || !ProjectConstants.DEFAULT_PROJECT_ID.equals(instance.getProjectId())) {
            throw notFound(id);
        }
        return instance;
    }

    private ApiException notFound(String id) {
        return new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                "Process instance not found: " + id);
    }
}
