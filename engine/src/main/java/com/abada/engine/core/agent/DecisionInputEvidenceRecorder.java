package com.abada.engine.core.agent;

import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.DecisionTableAudit;
import com.abada.engine.persistence.entity.DecisionInputEvidenceEntity;
import com.abada.engine.persistence.repository.DecisionInputEvidenceRepository;
import com.abada.engine.persistence.repository.ProjectRepository;
import com.abada.engine.security.AesEncryption;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;

/**
 * Keeps the resolved inputs of each decision-table application as evidence, in the caller's transaction, so an
 * operator can see what the table read next to the rule it matched. The project's evidence policy decides what is
 * kept: nothing under {@code none}, masked values under {@code redacted}, the values as evaluated under
 * {@code full}; always encrypted, always cleared after retention. History carries the row's id only.
 */
@Service
public class DecisionInputEvidenceRecorder {
    private final DecisionInputEvidenceRepository evidence;
    private final ProjectRepository projects;
    private final AesEncryption encryption;
    private final ObjectMapper json;

    public DecisionInputEvidenceRecorder(DecisionInputEvidenceRepository evidence, ProjectRepository projects,
            AesEncryption encryption, ObjectMapper json) {
        this.evidence = evidence;
        this.projects = projects;
        this.encryption = encryption;
        this.json = json;
    }

    /** Records one application's inputs; returns the evidence id that history may reference. */
    public String record(ProcessInstance instance, DecisionTableAudit audit, Instant now) {
        EvidencePolicy policy = Optional.ofNullable(instance.getProjectId()).flatMap(projects::findById)
                .map(row -> new EvidencePolicy(EvidencePolicy.Mode.fromWire(row.getEvidencePayloads()),
                        row.getEvidenceRetentionDays()))
                .orElse(EvidencePolicy.DEFAULT);
        DecisionInputEvidenceEntity row = new DecisionInputEvidenceEntity();
        row.setId(audit.visitId());
        row.setInstanceId(instance.getId());
        row.setProjectId(instance.getProjectId());
        row.setActivityId(audit.activityId());
        row.setDecisionKey(audit.decisionKey());
        row.setPayloadMode(policy.payloads().wireName());
        row.setCreatedAt(now);
        row.setPurgeAfter(now.plus(policy.retentionDays(), ChronoUnit.DAYS));
        if (policy.payloads() != EvidencePolicy.Mode.NONE) {
            JsonNode original = json.valueToTree(audit.inputs());
            JsonNode kept = original;
            if (policy.payloads() == EvidencePolicy.Mode.REDACTED) {
                kept = redactorFor(instance).redact(original);
                row.setRedacted(!kept.equals(original));
            }
            row.setInputsEnc(encryption.encrypt(AgentStepService.canonicalJson(kept)));
        }
        evidence.save(row);
        return row.getId();
    }

    /**
     * Masks the instance's sensitive variables by name and, wherever they appear, by value: an input may read a
     * sensitive variable under another name.
     */
    private static EvidenceRedactor redactorFor(ProcessInstance instance) {
        Map<String, Object> sensitive = new LinkedHashMap<>();
        for (String name : instance.getDefinition().getSensitiveVariables()) {
            sensitive.put(name, instance.getVariables().get(name));
        }
        return new EvidenceRedactor(sensitive);
    }
}
