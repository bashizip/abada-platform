package com.abada.engine.tools;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.ToolBinding;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.entity.ToolCredentialEntity;
import com.abada.engine.persistence.entity.ToolCredentialId;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.ToolCredentialRepository;
import com.abada.engine.project.ProjectAccessService;
import com.abada.engine.security.AesEncryption;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Secrets that tool server documents name in {@code credential}. People write
 * them and see only a hint; the only reader of a value is the worker holding
 * the lease of an agent task bound to a server that names the credential.
 * Nothing here logs or returns a value except {@link #issueForTask}.
 */
@Service
public class ToolCredentialService {
    private static final Logger log = LoggerFactory.getLogger(ToolCredentialService.class);
    private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9_.-]{0,127}");
    static final int MAX_SECRET_BYTES = 8 * 1024;

    public record CredentialSummary(String name, String hint, Instant updatedAt) {}

    public record IssuedCredential(String server, String credential, String secret) {
        @Override
        public String toString() {
            return "IssuedCredential[server=" + server + ", credential=" + credential + "]";
        }
    }

    private final ToolCredentialRepository credentials;
    private final ExternalTaskRepository externalTasks;
    private final AbadaEngine engine;
    private final ProjectAccessService access;
    private final AesEncryption encryption;
    private final ActivityHistoryService history;

    public ToolCredentialService(ToolCredentialRepository credentials, ExternalTaskRepository externalTasks,
            AbadaEngine engine, ProjectAccessService access, AesEncryption encryption,
            ActivityHistoryService history) {
        this.credentials = credentials;
        this.externalTasks = externalTasks;
        this.engine = engine;
        this.access = access;
        this.encryption = encryption;
        this.history = history;
    }

    @Transactional(readOnly = true)
    public List<CredentialSummary> list(String projectId) {
        access.requireVisible(projectId);
        return credentials.findByProjectIdOrderByNameAsc(projectId).stream()
                .map(row -> new CredentialSummary(row.getName(), row.getSecretHint(), row.getUpdatedAt()))
                .toList();
    }

    /** Creates or rotates a credential. Recorded in history with the actor, never the value. */
    @Transactional
    public CredentialSummary save(String projectId, String name, String secret) {
        access.requireActive(projectId, Role.OWNER, Role.MAINTAINER);
        if (name == null || !NAME.matcher(name).matches()) {
            throw invalid("Credential name must match [a-z][a-z0-9_.-]{0,127}");
        }
        if (secret == null || secret.isBlank()) throw invalid("secret is required");
        String value = secret.strip();
        if (value.getBytes(StandardCharsets.UTF_8).length > MAX_SECRET_BYTES) {
            throw invalid("secret exceeds " + MAX_SECRET_BYTES / 1024 + " KiB");
        }
        Instant now = Instant.now();
        ToolCredentialEntity row = credentials.findById(new ToolCredentialId(projectId, name)).orElse(null);
        boolean created = row == null;
        if (created) {
            row = new ToolCredentialEntity();
            row.setProjectId(projectId);
            row.setName(name);
            row.setCreatedAt(now);
        }
        row.setSecretEnc(encryption.encrypt(value));
        row.setSecretHint(value.length() > 4 ? "****" + value.substring(value.length() - 4) : "****");
        row.setUpdatedAt(now);
        credentials.save(row);
        history.record(created ? "TOOL_CREDENTIAL_CREATED" : "TOOL_CREDENTIAL_ROTATED", null, null, null,
                Map.of("projectId", projectId, "credential", name));
        return new CredentialSummary(row.getName(), row.getSecretHint(), row.getUpdatedAt());
    }

    @Transactional
    public void delete(String projectId, String name) {
        access.requireActive(projectId, Role.OWNER, Role.MAINTAINER);
        ToolCredentialEntity row = credentials.findById(new ToolCredentialId(projectId, name))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "Tool credential not found"));
        credentials.delete(row);
        history.record("TOOL_CREDENTIAL_DELETED", null, null, null,
                Map.of("projectId", projectId, "credential", name));
    }

    /**
     * The credential of {@code server} for the worker that holds the lease of
     * {@code externalTaskId}. Refused unless the task is locked by that worker,
     * its lease is live, and the task's frozen bindings include the server.
     */
    @Transactional(readOnly = true)
    public IssuedCredential issueForTask(String externalTaskId, String workerId, String server) {
        ExternalTaskEntity task = externalTasks.findById(externalTaskId).orElseThrow(() -> new ApiException(
                HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "External task not found"));
        if (workerId == null || task.getStatus() != ExternalTaskEntity.Status.LOCKED
                || !workerId.equals(task.getWorkerId()) || task.getLockExpirationTime() == null
                || !task.getLockExpirationTime().isAfter(Instant.now())) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "Tool credentials are issued only to the worker holding the task's lease");
        }
        ProcessInstance instance = engine.getProcessInstanceById(task.getProcessInstanceId());
        if (instance == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "Process instance not found");
        }
        ToolBinding binding = engine.toolBindings(instance, task.getActivityId()).stream()
                .filter(candidate -> candidate.server().equals(server)).findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                        "This task is not bound to tool server '" + server + "'"));
        if (binding.credential() == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                    "Tool server '" + server + "' declares no credential");
        }
        ToolCredentialEntity row = credentials.findById(new ToolCredentialId(instance.getProjectId(),
                binding.credential())).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,
                ApiErrorCode.RESOURCE_NOT_FOUND, "Tool credential '" + binding.credential() + "' is not set"));
        log.info("tool_credential_issued task_id={} server={} credential={} revision={}",
                externalTaskId, server, binding.credential(), row.getVersion());
        return new IssuedCredential(server, binding.credential(), encryption.decrypt(row.getSecretEnc()));
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, message);
    }
}
