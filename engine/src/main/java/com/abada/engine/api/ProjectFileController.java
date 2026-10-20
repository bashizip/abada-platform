package com.abada.engine.api;

import com.abada.engine.context.UserContextProvider;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.IdempotencyService;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.files.FilePolicyService;
import com.abada.engine.files.FileReadAccess;
import com.abada.engine.files.ObjectStore;
import com.abada.engine.files.ProcessFileService;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.ProcessFileEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.project.ProjectAccessService;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Files of human-task forms (S9). Uploads go to a task's file field and stay
 * {@code PENDING} until the task is completed with their ids; reads are proxied
 * by the engine so permissions and audit apply to every one. No presigned URLs.
 */
@RestController
public class ProjectFileController {
    private final AbadaEngine engine;
    private final UserContextProvider context;
    private final ProjectAccessService access;
    private final ProcessFileService files;
    private final FileReadAccess readers;
    private final FilePolicyService policies;
    private final ExternalTaskRepository externalTasks;
    private final IdempotencyService idempotency;

    public ProjectFileController(AbadaEngine engine, UserContextProvider context, ProjectAccessService access,
            ProcessFileService files, FileReadAccess readers, FilePolicyService policies,
            ExternalTaskRepository externalTasks, IdempotencyService idempotency) {
        this.engine = engine;
        this.context = context;
        this.access = access;
        this.files = files;
        this.readers = readers;
        this.policies = policies;
        this.externalTasks = externalTasks;
        this.idempotency = idempotency;
    }

    @Operation(summary = "Upload a file to a task's file field",
            description = "The body is the file itself (any content type) with a Content-Length; `name` is the "
                    + "file's name. The engine sniffs the type from the bytes, checks the field's rules and the "
                    + "size caps, stores the bytes in the object store and returns a PENDING file. Complete the "
                    + "task with the file id in the field to attach it.")
    @PostMapping("/v1/projects/{projectId}/tasks/{taskId}/files")
    public ResponseEntity<ProcessFileService.FileView> upload(@PathVariable String projectId,
            @PathVariable String taskId, @RequestParam String field, @RequestParam String name,
            HttpServletRequest request) throws IOException {
        access.require(projectId, Role.OPERATOR, Role.VIEWER);
        requireTaskInProject(projectId, taskId);
        ProcessFileService.UploadTarget target = engine.fileUploadTarget(taskId, context.getUsername(),
                context.getGroups(), field);
        try (InputStream body = request.getInputStream()) {
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(files.upload(target, name, request.getContentLengthLong(), body));
        }
    }

    @Operation(summary = "A file's metadata")
    @GetMapping("/v1/projects/{projectId}/files/{fileId}/metadata")
    public ProcessFileService.FileView metadata(@PathVariable String projectId, @PathVariable String fileId) {
        return ProcessFileService.FileView.of(readable(projectId, fileId));
    }

    @Operation(summary = "Download a file", description = "Proxied by the engine: always an attachment, "
            + "never sniffed by the browser. 410 FILE_UNAVAILABLE when the object store no longer has it.")
    @GetMapping("/v1/projects/{projectId}/files/{fileId}")
    public void download(@PathVariable String projectId, @PathVariable String fileId,
            HttpServletResponse response) throws IOException {
        stream(readable(projectId, fileId), "user", response);
    }

    @Operation(summary = "Remove a file before the task is completed")
    @DeleteMapping("/v1/projects/{projectId}/files/{fileId}")
    public ResponseEntity<Void> discard(@PathVariable String projectId, @PathVariable String fileId) {
        access.require(projectId, Role.OPERATOR, Role.VIEWER, Role.OWNER);
        files.discard(projectId, fileId, context.getUsername());
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "The project's file retention",
            description = "retentionDays: how long a finished instance keeps its attached files; null keeps them.")
    @GetMapping("/v1/projects/{projectId}/file-policy")
    public FilePolicyService.PolicyView policy(@PathVariable String projectId) {
        return policies.policy(projectId);
    }

    @PutMapping("/v1/projects/{projectId}/file-policy")
    public FilePolicyService.PolicyView setPolicy(@PathVariable String projectId,
            @RequestBody FilePolicyService.PolicyView request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        Map<String, Object> fingerprint = new java.util.LinkedHashMap<>();
        fingerprint.put("projectId", projectId);
        fingerprint.put("retentionDays", request == null ? null : request.retentionDays());
        return idempotency.execute(idempotencyKey, "project.file-policy.set", fingerprint,
                new com.fasterxml.jackson.core.type.TypeReference<FilePolicyService.PolicyView>() {},
                () -> policies.setPolicy(projectId, request == null ? null : request.retentionDays()));
    }

    @Operation(summary = "Download a file for an external task",
            description = "For the worker holding the task's lease: files attached to the task's instance.")
    @GetMapping("/v1/external-tasks/{id}/files/{fileId}")
    public void workerDownload(@PathVariable("id") String taskId, @PathVariable String fileId,
            @RequestParam String workerId, HttpServletResponse response) throws IOException {
        ExternalTaskEntity task = externalTasks.findById(taskId).orElseThrow(() -> new ApiException(
                HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "External task not found"));
        if (task.getStatus() != ExternalTaskEntity.Status.LOCKED || !workerId.equals(task.getWorkerId())
                || task.getLockExpirationTime() == null || !task.getLockExpirationTime().isAfter(Instant.now())) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.WORKER_LOCK_NOT_OWNED,
                    "Files are served only to the worker holding the task's lease");
        }
        ProcessInstance instance = engine.getProcessInstanceById(task.getProcessInstanceId());
        if (instance == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "File not found");
        }
        ProcessFileEntity row = files.require(instance.getProjectId(), fileId);
        if (row.getState() != ProcessFileEntity.State.ATTACHED || !row.getInstanceId().equals(instance.getId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "File not found");
        }
        stream(row, "worker", response);
    }

    private ProcessFileEntity readable(String projectId, String fileId) {
        access.requireVisible(projectId);
        return files.requireReadable(projectId, fileId, context.getUsername(), readers::mayRead);
    }

    private void stream(ProcessFileEntity row, String via, HttpServletResponse response) throws IOException {
        try (ObjectStore.StoredObject object = files.openForRead(row, via)) {
            response.setStatus(HttpStatus.OK.value());
            response.setContentType(row.getContentType());
            response.setContentLengthLong(row.getSizeBytes());
            response.setHeader(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + asciiName(row.getName())
                    + "\"; filename*=UTF-8''" + URLEncoder.encode(row.getName(), StandardCharsets.UTF_8)
                    .replace("+", "%20"));
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.setHeader(HttpHeaders.CACHE_CONTROL, "private, no-store");
            response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
            response.setHeader(HttpHeaders.ETAG, "\"" + row.getSha256() + "\"");
            try (OutputStream out = response.getOutputStream()) {
                object.body().transferTo(out);
            }
        }
    }

    /** The name for old clients: printable ASCII, quotes and backslashes replaced. */
    private static String asciiName(String name) {
        StringBuilder ascii = new StringBuilder();
        name.chars().forEach(c -> ascii.append(c >= 0x20 && c < 0x7F && c != '"' && c != '\\' ? (char) c : '_'));
        return ascii.toString();
    }

    private TaskInstance requireTaskInProject(String projectId, String taskId) {
        TaskInstance task = engine.getTaskById(taskId).orElseThrow(() -> new ApiException(
                HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "Project task not found"));
        ProcessInstance instance = engine.getProcessInstanceById(task.getProcessInstanceId());
        if (instance == null || !projectId.equals(instance.getProjectId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "Project task not found");
        }
        return task;
    }
}
