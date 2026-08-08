package com.abada.engine.api;

import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.IdempotencyService;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.dto.Mapper;
import com.abada.engine.dto.ProcessDefinitionDto;
import com.abada.engine.dto.ProcessInstanceDTO;
import com.abada.engine.dto.ProcessStartResponse;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.project.ProjectAccessService;
import com.abada.engine.security.IdentityContext;
import com.fasterxml.jackson.core.type.TypeReference;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.PageRequest;
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
@RequestMapping("/v1/projects/{projectId}")
public class ProjectProcessController {
    private final AbadaEngine engine;
    private final ProjectAccessService access;
    private final IdempotencyService idempotency;

    public ProjectProcessController(AbadaEngine engine, ProjectAccessService access,
            IdempotencyService idempotency) {
        this.engine = engine;
        this.access = access;
        this.idempotency = idempotency;
    }

    @GetMapping("/processes")
    public ResponseEntity<List<ProcessDefinitionDto>> processes(@PathVariable String projectId,
            @RequestParam(required = false) String key,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        access.require(projectId, Role.VIEWER, Role.MAINTAINER, Role.OPERATOR, Role.REVIEWER, Role.OWNER);
        var pageable = PageRequest.of(page, Math.min(Math.max(size, 1), 100),
                Sort.by("processKey").ascending().and(Sort.by("version").descending()));
        var result = engine.getDeployedProcesses(projectId, key, pageable);
        return ResponseEntity.ok().headers(Pagination.headers(result))
                .body(result.stream().map(ProcessDefinitionDto::from).toList());
    }

    @GetMapping("/processes/{processKey}")
    public ResponseEntity<ProcessDefinitionDto> process(@PathVariable String projectId,
            @PathVariable String processKey) {
        access.require(projectId, Role.VIEWER, Role.MAINTAINER, Role.OPERATOR, Role.REVIEWER, Role.OWNER);
        return engine.getProcessDefinitionById(projectId, processKey).map(ProcessDefinitionDto::from)
                .map(ResponseEntity::ok).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,
                        ApiErrorCode.RESOURCE_NOT_FOUND, "Project process definition not found"));
    }

    @PostMapping("/processes/{processKey}/start")
    public ResponseEntity<ProcessStartResponse> start(@PathVariable String projectId,
            @PathVariable String processKey,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) Map<String, Object> variables) {
        access.requireActive(projectId, Role.OPERATOR);
        Map<String, Object> initial = variables == null ? Map.of() : variables;
        String actor = IdentityContext.get().map(identity -> identity.username()).orElse("system");
        var request = Map.of("projectId", projectId, "processKey", processKey,
                "actor", actor, "variables", initial);
        return ResponseEntity.ok(idempotency.execute(idempotencyKey, "project.process.start", request,
                new TypeReference<ProcessStartResponse>() {}, () -> new ProcessStartResponse(
                        engine.startProcess(projectId, processKey, actor, initial).getId())));
    }

    @GetMapping("/instances")
    public ResponseEntity<List<ProcessInstanceDTO>> instances(@PathVariable String projectId,
            @RequestParam(required = false) ProcessStatus status,
            @RequestParam(required = false) String processDefinitionId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        var pageable = PageRequest.of(page, Math.min(Math.max(size, 1), 100),
                Sort.by("startDate").descending());
        var result = engine.getProcessInstances(projectId, status, processDefinitionId, pageable);
        return ResponseEntity.ok().headers(Pagination.headers(result))
                .body(result.stream().map(Mapper.ProcessInstanceMapper::toDto).toList());
    }

    @GetMapping("/instances/{instanceId}")
    public ResponseEntity<ProcessInstanceDTO> instance(@PathVariable String projectId,
            @PathVariable String instanceId) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        var instance = engine.getProcessInstanceById(instanceId);
        if (instance == null || !projectId.equals(instance.getProjectId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                    "Project process instance not found");
        }
        return ResponseEntity.ok(Mapper.ProcessInstanceMapper.toDto(instance));
    }

    @PostMapping("/instances/{instanceId}/fail")
    public ResponseEntity<Void> fail(@PathVariable String projectId, @PathVariable String instanceId) {
        access.require(projectId, Role.OPERATOR, Role.OWNER);
        var instance = engine.getProcessInstanceById(instanceId);
        if (instance == null || !projectId.equals(instance.getProjectId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                    "Project process instance not found");
        }
        engine.failProcess(instanceId);
        return ResponseEntity.noContent().build();
    }
}
