package com.abada.engine.core.agent;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.dto.AgentStepEvidenceDto;
import com.abada.engine.persistence.entity.AgentStepEntity;
import com.abada.engine.persistence.entity.ProjectEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.AgentStepRepository;
import com.abada.engine.persistence.repository.ProjectRepository;
import com.abada.engine.project.ProjectAccessService;
import com.abada.engine.security.AesEncryption;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reading agent evidence and setting a project's evidence policy. Project
 * members see step summaries (digests, tokens, cost); payloads need the
 * evidence-reader role and every read is recorded in history.
 */
@Service
public class AgentEvidenceService {
    public record Payloads(String stepId, String payloadMode, JsonNode request, JsonNode result) {}

    public record PolicyView(String payloads, int retentionDays) {}

    private final AgentStepRepository steps;
    private final ProjectRepository projects;
    private final ProjectAccessService access;
    private final AbadaEngine engine;
    private final AesEncryption encryption;
    private final ObjectMapper json;
    private final ActivityHistoryService history;

    public AgentEvidenceService(AgentStepRepository steps, ProjectRepository projects, ProjectAccessService access,
            AbadaEngine engine, AesEncryption encryption, ObjectMapper json, ActivityHistoryService history) {
        this.steps = steps;
        this.projects = projects;
        this.access = access;
        this.engine = engine;
        this.encryption = encryption;
        this.json = json;
        this.history = history;
    }

    @Transactional(readOnly = true)
    public List<AgentStepEvidenceDto> steps(String projectId, String instanceId) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        requireInstance(projectId, instanceId);
        return steps.findByProcessInstanceIdOrderByStartedAtAscSequenceAsc(instanceId).stream()
                .map(AgentEvidenceService::summary).toList();
    }

    /** The evidence copy of one step's payloads, for an evidence reader of the project; audited. */
    @Transactional
    public Payloads payloads(String projectId, String instanceId, String stepId) {
        access.requireEvidenceReader(projectId);
        ProcessInstance instance = requireInstance(projectId, instanceId);
        AgentStepEntity step = steps.findById(stepId).filter(found -> found.getProcessInstanceId().equals(instanceId))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                        "Agent step not found"));
        if (step.getPurgedAt() != null) {
            throw new ApiException(HttpStatus.GONE, ApiErrorCode.WORK_RETIRED,
                    "The payloads of this step were purged after its retention period");
        }
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("stepId", stepId);
        details.put("sequence", step.getSequence());
        details.put("attempt", step.getAttempt());
        details.put("payloadMode", step.getPayloadMode());
        history.record("EVIDENCE_READ", instance, step.getActivityId(), details);
        return new Payloads(stepId, step.getPayloadMode(), decrypt(step.getEvidenceRequestEnc()),
                decrypt(step.getEvidenceResultEnc()));
    }

    @Transactional(readOnly = true)
    public PolicyView policy(String projectId) {
        ProjectEntity project = access.requireVisible(projectId);
        return new PolicyView(project.getEvidencePayloads(), project.getEvidenceRetentionDays());
    }

    /** Sets the project's evidence policy (owners only); applies to steps recorded from now on. */
    @Transactional
    public PolicyView setPolicy(String projectId, String payloads, Integer retentionDays) {
        ProjectEntity project = access.requireActive(projectId, Role.OWNER);
        EvidencePolicy.Mode mode = EvidencePolicy.Mode.fromWire(payloads);
        if (mode == null) throw invalid("payloads must be none, redacted or full");
        if (retentionDays == null || retentionDays < 1 || retentionDays > EvidencePolicy.MAX_RETENTION_DAYS) {
            throw invalid("retentionDays must be between 1 and " + EvidencePolicy.MAX_RETENTION_DAYS);
        }
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("projectId", projectId);
        details.put("fromPayloads", project.getEvidencePayloads());
        details.put("fromRetentionDays", project.getEvidenceRetentionDays());
        details.put("toPayloads", mode.wireName());
        details.put("toRetentionDays", retentionDays);
        project.setEvidencePayloads(mode.wireName());
        project.setEvidenceRetentionDays(retentionDays);
        project.setUpdatedAt(Instant.now());
        projects.save(project);
        history.record("EVIDENCE_POLICY_CHANGED", null, null, null, details);
        return new PolicyView(project.getEvidencePayloads(), project.getEvidenceRetentionDays());
    }

    private ProcessInstance requireInstance(String projectId, String instanceId) {
        ProcessInstance instance = engine.getProcessInstanceById(instanceId);
        if (instance == null || !projectId.equals(instance.getProjectId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND,
                    "Project process instance not found");
        }
        return instance;
    }

    private JsonNode decrypt(String ciphertext) {
        if (ciphertext == null) return null;
        try {
            return json.readTree(encryption.decrypt(ciphertext));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("An evidence payload cannot be read", exception);
        }
    }

    private static AgentStepEvidenceDto summary(AgentStepEntity step) {
        return new AgentStepEvidenceDto(step.getId(), step.getExternalTaskId(), step.getActivityId(),
                step.getAttempt(), step.getSequence(), step.getKind().name(), step.getToolRef(), step.getPolicy(),
                step.getState().name(), step.getRequestDigest(), step.getResultDigest(), step.getErrorType(),
                step.getModel(), step.getPromptVersion(), step.getPromptTokens(), step.getCompletionTokens(),
                step.getCostUsd(), step.isCostUnpriced(), step.getPayloadMode(), step.getResolvedBy(),
                step.getStartedAt(), step.getFinishedAt(), step.getPurgedAt(), step.getDecidedAt(),
                step.getChildInstanceId());
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, message);
    }
}
