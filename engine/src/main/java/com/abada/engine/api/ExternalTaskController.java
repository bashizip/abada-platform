package com.abada.engine.api;

import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.IdempotencyService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.abada.engine.dto.ExternalTaskFailureDto;
import com.abada.engine.dto.ExternalTaskBpmnErrorRequest;
import com.abada.engine.dto.CompleteExternalTaskRequest;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.dto.ExtendLockRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.annotation.Value;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import com.abada.engine.project.ProjectWorkerService;

/**
 * REST controller for external task workers.
 * This API provides the necessary endpoints for external workers to fetch,
 * lock, and complete jobs,
 * enabling the "External Task Worker" pattern.
 */
@RestController
@RequestMapping("/v1/external-tasks")
public class ExternalTaskController {

    private final ExternalTaskCommandService commands;
    private final IdempotencyService idempotency;
    private final ObjectMapper objectMapper;
    private final String securityMode;
    private final ProjectWorkerService projectWorkers;

    public ExternalTaskController(ExternalTaskCommandService commands, IdempotencyService idempotency,
            ObjectMapper objectMapper, @Value("${abada.security.mode:disabled}") String securityMode,
            ProjectWorkerService projectWorkers) {
        this.commands = commands;
        this.idempotency = idempotency;
        this.objectMapper = objectMapper;
        this.securityMode = securityMode;
        this.projectWorkers = projectWorkers;
    }

    /**
     * Fetches and locks available external tasks for a given set of topics.
     * This endpoint is designed to be polled by external task workers.
     * The method is transactional and will attempt to find and lock one available
     * task.
     *
     * @param request The request body containing the worker ID, a list of topics
     *                the worker can handle,
     *                and the desired lock duration in milliseconds.
     * @return A ResponseEntity containing a list of locked tasks. The list will
     *         contain at most one task,
     *         or be empty if no tasks are available for the given topics.
     */
    @PostMapping("/fetch-and-lock")
    public ResponseEntity<List<LockedExternalTask>> fetchAndLock(@RequestBody FetchAndLockRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        if (!"disabled".equalsIgnoreCase(securityMode)
                && (request.projectId() == null || request.projectId().isBlank())) {
            throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    ApiErrorCode.INVALID_REQUEST, "projectId is required for secured workers");
        }
        if (request.projectId() != null) projectWorkers.requireCurrentWorker(request.projectId(), request.topics());
        return ResponseEntity.ok().header("X-Abada-Worker-Protocol-Version", "1")
                .body(idempotency.execute(idempotencyKey, "external-task.fetch-and-lock", request,
                        new TypeReference<List<LockedExternalTask>>() {}, () -> commands.fetchAndLock(request)));
    }

    /**
     * Completes an external task and resumes the corresponding process instance.
     * This endpoint is called by a worker after it has successfully finished its
     * business logic.
     *
     * @param id        The unique ID of the external task to complete. This is the
     *                  ID that was returned
     *                  in the `LockedExternalTask` payload from the
     *                  `fetch-and-lock` endpoint.
     *                  It is **not** the topic name.
     * @param variables A map of variables to pass back to the process instance.
     *                  These variables will be
     *                  merged into the process scope before the engine advances.
     * @return An HTTP 200 OK response on successful completion.
     */
    @PostMapping("/{id}/complete")
    public ResponseEntity<Void> complete(@PathVariable String id,
            @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true,
                    content = @io.swagger.v3.oas.annotations.media.Content(
                            schema = @io.swagger.v3.oas.annotations.media.Schema(
                                    implementation = CompleteExternalTaskRequest.class)))
            @RequestBody JsonNode payload,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        CompleteExternalTaskRequest request = completeRequest(payload);
        if (!"disabled".equalsIgnoreCase(securityMode)) projectWorkers.requireCurrentWorkerForTask(id);
        idempotency.execute(idempotencyKey, "external-task.complete", Map.of("id", id, "request", request), () -> {
            commands.complete(id, request.workerId(), request.effectiveVariables(), request.agent());
            return Map.of("status", "Completed", "externalTaskId", id);
        });
        return ResponseEntity.ok().build();
    }

    /**
     * Reports a failure for an external task.
     * This endpoint is called by a worker when it fails to process a task.
     *
     * @param id         The unique ID of the external task.
     * @param failureDto The failure details.
     * @return An HTTP 200 OK response.
     */
    @PostMapping("/{id}/failure")
    public ResponseEntity<Void> handleFailure(@PathVariable String id, @RequestBody ExternalTaskFailureDto failureDto,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        if (!"disabled".equalsIgnoreCase(securityMode)) projectWorkers.requireCurrentWorkerForTask(id);
        idempotency.execute(idempotencyKey, "external-task.failure", Map.of("id", id, "failure", failureDto), () -> {
            commands.handleFailure(id, failureDto);
            return Map.of("status", "Failure recorded", "externalTaskId", id);
        });
        return ResponseEntity.ok().build();
    }

    @PostMapping("/{id}/extend-lock")
    public ResponseEntity<Void> extendLock(@PathVariable String id, @RequestBody ExtendLockRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        if (!"disabled".equalsIgnoreCase(securityMode)) projectWorkers.requireCurrentWorkerForTask(id);
        idempotency.execute(idempotencyKey, "external-task.extend-lock", Map.of("id", id, "request", request), () -> {
            commands.extendLock(id, request);
            return Map.of("status", "Lock extended", "externalTaskId", id);
        });
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/heartbeat")
    public ResponseEntity<Void> heartbeat(@PathVariable String id, @RequestBody ExtendLockRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        if (!"disabled".equalsIgnoreCase(securityMode)) projectWorkers.requireCurrentWorkerForTask(id);
        idempotency.execute(idempotencyKey, "external-task.heartbeat", Map.of("id", id, "request", request), () -> {
            commands.extendLock(id, request);
            return Map.of("status", "Heartbeat accepted", "externalTaskId", id);
        });
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/bpmn-error")
    public ResponseEntity<Void> handleBpmnError(@PathVariable String id,
            @RequestBody ExternalTaskBpmnErrorRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        if (!"disabled".equalsIgnoreCase(securityMode)) projectWorkers.requireCurrentWorkerForTask(id);
        idempotency.execute(idempotencyKey, "external-task.bpmn-error", Map.of("id", id, "request", request), () -> {
            commands.handleBpmnError(id, request);
            return Map.of("status", "BPMN error handled", "externalTaskId", id);
        });
        return ResponseEntity.noContent().build();
    }

    private CompleteExternalTaskRequest completeRequest(JsonNode payload) {
        if (payload != null && payload.isObject() && (payload.has("workerId") || payload.has("variables"))) {
            CompleteExternalTaskRequest request = objectMapper.convertValue(payload, CompleteExternalTaskRequest.class);
            if (!"disabled".equalsIgnoreCase(securityMode)
                    && (request.workerId() == null || request.workerId().isBlank())) {
                throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                        "workerId is required for external-task completion");
            }
            return request;
        }
        Map<String, Object> legacyVariables = payload == null || payload.isNull() ? Map.of()
                : objectMapper.convertValue(payload, new TypeReference<Map<String, Object>>() {});
        if (!"disabled".equalsIgnoreCase(securityMode)) {
            throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST,
                    "Use the worker protocol v1 completion body with workerId and variables");
        }
        return new CompleteExternalTaskRequest(null, legacyVariables);
    }
}
