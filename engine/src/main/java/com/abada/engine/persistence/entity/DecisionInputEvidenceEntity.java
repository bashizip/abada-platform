package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * The resolved inputs of one decision-table application, kept under the project's evidence policy. The id is the
 * application's visit id, which {@code DECISION_TABLE_APPLIED} carries as {@code evidenceId}. The payload is
 * encrypted, absent under {@code none}, and cleared once {@code purge_after} passes.
 */
@Entity
@Table(name = "decision_input_evidence")
public class DecisionInputEvidenceEntity {
    @Id
    private String id;

    @Column(name = "instance_id")
    private String instanceId;

    @Column(name = "project_id")
    private String projectId;

    @Column(name = "activity_id")
    private String activityId;

    @Column(name = "decision_key")
    private String decisionKey;

    @Column(name = "payload_mode")
    private String payloadMode;

    @Column(name = "inputs_enc", columnDefinition = "TEXT")
    private String inputsEnc;

    private boolean redacted;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "purge_after")
    private Instant purgeAfter;

    @Column(name = "purged_at")
    private Instant purgedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getInstanceId() { return instanceId; }
    public void setInstanceId(String instanceId) { this.instanceId = instanceId; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getActivityId() { return activityId; }
    public void setActivityId(String activityId) { this.activityId = activityId; }
    public String getDecisionKey() { return decisionKey; }
    public void setDecisionKey(String decisionKey) { this.decisionKey = decisionKey; }
    public String getPayloadMode() { return payloadMode; }
    public void setPayloadMode(String payloadMode) { this.payloadMode = payloadMode; }
    public String getInputsEnc() { return inputsEnc; }
    public void setInputsEnc(String inputsEnc) { this.inputsEnc = inputsEnc; }
    public boolean isRedacted() { return redacted; }
    public void setRedacted(boolean redacted) { this.redacted = redacted; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getPurgeAfter() { return purgeAfter; }
    public void setPurgeAfter(Instant purgeAfter) { this.purgeAfter = purgeAfter; }
    public Instant getPurgedAt() { return purgedAt; }
    public void setPurgedAt(Instant purgedAt) { this.purgedAt = purgedAt; }
}
