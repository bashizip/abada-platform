package com.abada.engine.core.versioning;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.core.AtomicRuntimeCommand;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.persistence.PersistenceService;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.persistence.repository.InsightProposalRepository;
import com.abada.engine.persistence.repository.ProcessDefinitionRepository;
import com.abada.engine.persistence.repository.ProcessInstanceRepository;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Version history and rollback of a process (E16). A rollback is a deployment:
 * the stored source of an earlier version is deployed again as the next version,
 * through the normal path, so validation, immutability and pinning are the same.
 * History is never edited and running instances stay on the version they started on.
 */
@Service
public class DefinitionVersionService {
    public static final int MAX_COMMENT = 1000;

    public enum Origin { DEPLOY, ROLLBACK, INSIGHT }

    public record Version(int version, String deploymentId, String checksum, String schemaType, Instant createdAt,
            String deployedBy, Origin origin, Integer rollbackOf, Long proposalId, String comment,
            long runningInstances, boolean current) {}

    public record Diff(int from, int to, boolean identical, boolean tooLarge, String unified) {}

    private static final List<ProcessStatus> RUNNING = List.of(ProcessStatus.RUNNING, ProcessStatus.SUSPENDED);

    private final com.abada.engine.persistence.repository.ProjectRepository projects;
    private final ProcessDefinitionRepository definitions;
    private final ProcessInstanceRepository instances;
    private final InsightProposalRepository proposals;
    private final AbadaEngine engine;
    private final PersistenceService persistence;
    private final ActivityHistoryService history;
    private final com.abada.engine.audit.AdminAuditRecorder audit;

    public DefinitionVersionService(com.abada.engine.persistence.repository.ProjectRepository projects,
            ProcessDefinitionRepository definitions, ProcessInstanceRepository instances,
            InsightProposalRepository proposals, AbadaEngine engine, PersistenceService persistence,
            ActivityHistoryService history, com.abada.engine.audit.AdminAuditRecorder audit) {
        this.audit = audit;
        this.projects = projects;
        this.definitions = definitions;
        this.instances = instances;
        this.proposals = proposals;
        this.engine = engine;
        this.persistence = persistence;
        this.history = history;
    }

    @Transactional(readOnly = true)
    public List<Version> versions(String projectId, String processKey) {
        List<ProcessDefinitionEntity> all = definitions.findByProjectIdAndProcessKeyOrderByVersionDesc(projectId,
                processKey);
        if (all.isEmpty()) throw notFound();
        int latest = all.getFirst().getVersion();
        return all.stream().map(definition -> describe(definition, definition.getVersion() == latest)).toList();
    }

    @Transactional(readOnly = true)
    public Diff diff(String projectId, String processKey, int from, int to) {
        String before = require(projectId, processKey, from).getBpmnXml();
        String after = require(projectId, processKey, to).getBpmnXml();
        String unified = LineDiff.unified(before, after);
        return new Diff(from, to, unified != null && unified.isEmpty(), unified == null, unified);
    }

    /**
     * Deploys version {@code target}'s source as the next version. {@code expectedLatest}, when given, is the
     * version the caller saw as current; a stale value is refused. A dependency that no longer resolves (a tool
     * or called process that changed) is refused with the deployment's own typed errors and nothing is written.
     */
    @AtomicRuntimeCommand
    public ProcessDefinitionEntity rollback(String projectId, String processKey, int target, String comment,
            Integer expectedLatest) {
        String reason = comment == null ? "" : comment.strip();
        if (reason.isEmpty()) throw invalid("A comment saying why is required");
        if (reason.length() > MAX_COMMENT) throw invalid("The comment is longer than " + MAX_COMMENT + " characters");
        // Rollbacks of one project run one after the other, so each reads the previous one's committed version.
        projects.findByIdForUpdate(projectId).orElseThrow(DefinitionVersionService::notFound);
        ProcessDefinitionEntity latest = definitions.findFirstByProjectIdAndProcessKeyOrderByVersionDesc(projectId,
                processKey).orElseThrow(DefinitionVersionService::notFound);
        if (expectedLatest != null && expectedLatest != latest.getVersion()) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.CONCURRENT_MODIFICATION,
                    "The current version is " + latest.getVersion() + ", not " + expectedLatest);
        }
        ProcessDefinitionEntity source = require(projectId, processKey, target);
        if (source.getVersion() == latest.getVersion()) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "Version " + target + " is already the current version");
        }
        long unaffected = instances.countByProcessDefinitionDeploymentIdAndStatusIn(latest.getDeploymentId(), RUNNING);
        ProcessDefinitionEntity deployed = engine.deploy(projectId,
                new ByteArrayInputStream(source.getBpmnXml().getBytes(StandardCharsets.UTF_8)));
        if (deployed.getDeploymentId().equals(latest.getDeploymentId())) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "Version " + target + " has the same source and dependencies as the current version "
                            + latest.getVersion());
        }
        deployed.setRollbackOf(source.getVersion());
        deployed.setDeployComment(reason);
        persistence.saveProcessDefinition(deployed);
        String actor = IdentityContext.get().map(Identity::username).orElse("system");
        history.record("DEFINITION_ROLLED_BACK", null, processKey, null, Map.of(
                "projectId", projectId, "fromVersion", latest.getVersion(), "restoredVersion", source.getVersion(),
                "newVersion", deployed.getVersion(), "deploymentId", deployed.getDeploymentId(),
                "actor", actor, "commented", true, "runningOnReplacedVersion", unaffected));
        audit.recordSuccess(com.abada.engine.audit.AdminAuditActions.PROCESS_ROLLBACK,
                com.abada.engine.audit.AdminAuditActions.TARGET_PROCESS, processKey, projectId,
                com.abada.engine.audit.AdminAuditDetails.create().put("restoredVersion", source.getVersion())
                        .change("version", latest.getVersion(), deployed.getVersion())
                        .put("deploymentId", deployed.getDeploymentId()).put("comment", reason));
        return deployed;
    }

    /** How many instances still run on the current version, which a rollback leaves untouched. */
    @Transactional(readOnly = true)
    public long runningOnCurrent(String projectId, String processKey) {
        return definitions.findByProjectIdAndProcessKeyOrderByVersionDesc(projectId, processKey).stream().findFirst()
                .map(latest -> instances.countByProcessDefinitionDeploymentIdAndStatusIn(latest.getDeploymentId(),
                        RUNNING)).orElse(0L);
    }

    private Version describe(ProcessDefinitionEntity definition, boolean current) {
        var proposal = proposals.findFirstByAdoptedDeploymentId(definition.getDeploymentId());
        Origin origin = definition.getRollbackOf() != null ? Origin.ROLLBACK
                : proposal.isPresent() ? Origin.INSIGHT : Origin.DEPLOY;
        return new Version(definition.getVersion(), definition.getDeploymentId(), definition.getChecksum(),
                definition.getSchemaType(), definition.getCreatedAt(), definition.getDeployedBy(), origin,
                definition.getRollbackOf(), proposal.map(row -> row.getId()).orElse(null),
                definition.getDeployComment(),
                instances.countByProcessDefinitionDeploymentIdAndStatusIn(definition.getDeploymentId(), RUNNING),
                current);
    }

    private ProcessDefinitionEntity require(String projectId, String processKey, int version) {
        return definitions.findByProjectIdAndProcessKeyAndVersion(projectId, processKey, version)
                .orElseThrow(DefinitionVersionService::notFound);
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                "Process definition version not found");
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, message);
    }
}
