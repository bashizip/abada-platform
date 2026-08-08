package com.abada.engine.api;

import com.abada.engine.context.UserContextProvider;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.IdempotencyService;
import com.abada.engine.dto.Mapper;
import com.abada.engine.dto.DeploymentResponse;
import com.abada.engine.dto.ProcessActionResponse;
import com.abada.engine.dto.ProcessDefinitionDto;
import com.abada.engine.dto.ProcessInstanceDTO;
import com.abada.engine.dto.ProcessStartResponse;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.bpmn.compatibility.BpmnParseOptions;
import com.abada.engine.bpmn.compatibility.CompatibilityProfiles;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import com.abada.engine.project.ProjectConstants;

/**
 * REST controller for managing BPMN process definitions and instances.
 * Provides endpoints to deploy, list, and start processes, as well as query
 * their status.
 * 
 * Note: Operations cockpit endpoints (variable management, suspension,
 * cancellation, etc.)
 * are now in CockpitController under /v1/process-instances.
 */
@RestController
@RequestMapping("/v1/processes")
public class ProcessController {

    private final AbadaEngine engine;
    private final UserContextProvider context;
    private final IdempotencyService idempotencyService;
    private final ObjectMapper objectMapper;

    public ProcessController(AbadaEngine engine, UserContextProvider context, IdempotencyService idempotencyService,
            ObjectMapper objectMapper) {
        this.engine = engine;
        this.context = context;
        this.idempotencyService = idempotencyService;
        this.objectMapper = objectMapper;
    }

    /**
     * Deploys a new BPMN process definition from an XML file.
     *
     * @param file The BPMN 2.0 XML file as a multipart request part.
     * @return A JSON object confirming successful deployment.
     * @throws IOException If the file cannot be read.
     */
    @PostMapping(value = "/deploy", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<DeploymentResponse> deploy(@RequestParam("file") MultipartFile file,
            @RequestParam(required = false) String profiles,
            @RequestParam(defaultValue = "false") boolean strict,
            @RequestParam(defaultValue = "false") boolean rejectVendorExtensions,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) throws IOException {
        List<String> selectedProfiles = profiles == null || profiles.isBlank() ? CompatibilityProfiles.DEFAULT
                : java.util.Arrays.stream(profiles.split(",")).map(String::trim).filter(value -> !value.isEmpty()).toList();
        byte[] source = file.getBytes();
        Map<String, Object> request = Map.of("source", source, "profiles", selectedProfiles,
                "strict", strict, "rejectVendorExtensions", rejectVendorExtensions);
        return ResponseEntity.ok(idempotencyService.execute(idempotencyKey, "process.deploy", request,
                new TypeReference<DeploymentResponse>() {}, () -> {
            ProcessDefinitionEntity deployed = engine.deploy(new ByteArrayInputStream(source),
                    new BpmnParseOptions(selectedProfiles, rejectVendorExtensions, strict));
            return deploymentResponse(deployed);
        }));
    }

    private DeploymentResponse deploymentResponse(ProcessDefinitionEntity deployed) {
        try {
            Map<String, Object> compatibilityReport = objectMapper.readValue(deployed.getCompatibilityReport(),
                    new TypeReference<>() {});
            return new DeploymentResponse("Deployed", deployed.getProcessKey(), deployed.getDeploymentId(),
                    deployed.getVersion(), deployed.getDefinitionFormatVersion(), deployed.getSchemaType(),
                    List.of(deployed.getCompatibilityProfiles().split(",")), compatibilityReport);
        } catch (IOException exception) {
            throw new IllegalStateException("Stored compatibility report is invalid", exception);
        }
    }

    /**
     * Lists all currently deployed process definitions.
     * Each item includes 'id', 'name', 'documentation', and 'bpmnXml'.
     *
     * @return A list of all process definitions.
     */
    @GetMapping
    public ResponseEntity<List<ProcessDefinitionDto>> listProcesses(
            @RequestParam(required = false) String key,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = Pagination.DEFAULT_PAGE_SIZE) int size) {
        Pageable pageable = Pagination.request(page, size,
                Sort.by("processKey").ascending().and(Sort.by("version").descending()));
        Page<ProcessDefinitionEntity> definitions = engine.getDeployedProcesses(key, pageable);
        return ResponseEntity.ok().headers(Pagination.headers(definitions))
                .body(definitions.stream().map(ProcessDefinitionDto::from).toList());
    }

    /**
     * Starts a new instance of a specified process definition.
     * Optionally accepts a username parameter to track who initiated the process.
     *
     * @param processId    The ID of the process definition to start.
     * @param username     Optional username who starts the process (defaults to
     *                     "system")
     * @param variablesMap Optional initial process variables
     * @return A JSON object with the new process instance ID.
     */
    @PostMapping("/start")
    public ResponseEntity<ProcessStartResponse> startProcess(
            @RequestParam String processId,
            @RequestParam(required = false) String username,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) Map<String, Object> variablesMap) {

        Map<String, Object> variables = variablesMap == null ? Map.of() : variablesMap;
        ProcessStartResponse response = idempotencyService.execute(idempotencyKey, "process.start",
                Map.of("processId", processId, "username", username == null ? "" : username, "variables", variables),
                new TypeReference<ProcessStartResponse>() {},
                () -> {
                    ProcessInstance instance = engine.startProcess(processId, username, variables);
                    return new ProcessStartResponse(instance.getId());
                });
        return ResponseEntity.ok(response);
    }

    /**
     * Lists a bounded page of process instances across all process definitions.
     * Returns full ProcessInstanceDTO records and pagination response headers.
     *
     * @return A page of active and completed process instances.
     */
    @GetMapping("/instances")
    public ResponseEntity<List<ProcessInstanceDTO>> listProcessInstances(
            @RequestParam(required = false) ProcessStatus status,
            @RequestParam(required = false) String processDefinitionId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = Pagination.DEFAULT_PAGE_SIZE) int size) {
        Pageable pageable = Pagination.request(page, size,
                Sort.by("startDate").descending().and(Sort.by("id").ascending()));
        Page<ProcessInstance> instancePage = engine.getProcessInstances(status, processDefinitionId, pageable);
        List<ProcessInstanceDTO> instances = instancePage.stream()
                .map(Mapper.ProcessInstanceMapper::toDto)
                .collect(Collectors.toList());
        return ResponseEntity.ok()
                .headers(Pagination.headers(instancePage))
                .body(instances);
    }

    /**
     * Retrieves the details of a specific process instance by ID.
     * Returns a ProcessInstanceDTO with status, dates, and metadata.
     *
     * @param instanceId The ID of the process instance.
     * @return The process instance details, or 404 if not found.
     */
    @GetMapping("/instances/{instanceId}")
    public ResponseEntity<ProcessInstanceDTO> getProcessInstance(@PathVariable String instanceId) {
        ProcessInstance instance = engine.getProcessInstanceById(instanceId);
        if (instance == null || !ProjectConstants.DEFAULT_PROJECT_ID.equals(instance.getProjectId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                    "Process instance not found: " + instanceId);
        }
        return ResponseEntity.ok(Mapper.ProcessInstanceMapper.toDto(instance));
    }

    /**
     * Marks a process instance as FAILED.
     * This is a terminal status that stops all execution of the instance.
     *
     * @param id The unique ID of the process instance to fail.
     * @return A JSON object confirming the status change.
     */
    @PostMapping("/instance/{id}/fail")
    public ResponseEntity<ProcessActionResponse> failInstance(@PathVariable String id,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        ProcessInstance instance = engine.getProcessInstanceById(id);
        if (instance == null || !ProjectConstants.DEFAULT_PROJECT_ID.equals(instance.getProjectId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                    "Process instance not found: " + id);
        }
        ProcessActionResponse response = idempotencyService.execute(idempotencyKey, "process.fail",
                Map.of("processInstanceId", id), new TypeReference<ProcessActionResponse>() {}, () -> {
                    boolean failed = engine.failProcess(id);
                    if (!failed) {
                        throw new com.abada.engine.core.exception.ProcessEngineException(
                                "Cannot fail process instance: " + id);
                    }
                    return new ProcessActionResponse("Failed", id);
                });
        return ResponseEntity.ok(response);
    }

    /**
     * Retrieves a specific process definition by its ID.
     *
     * @param id The ID of the process definition (as defined in the BPMN file).
     * @return A map containing the definition's 'id', 'name', 'documentation', and
     *         the full 'bpmnXml'. Returns 404 Not Found if the ID is not found.
     */
    @GetMapping("/{id}")
    public ResponseEntity<ProcessDefinitionDto> getProcessById(@PathVariable String id) {
        return engine.getProcessDefinitionById(id)
                .map(ProcessDefinitionDto::from)
                .map(ResponseEntity::ok)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "Process definition not found: " + id));
    }

}
