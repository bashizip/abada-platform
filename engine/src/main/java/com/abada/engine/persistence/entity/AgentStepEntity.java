package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

/**
 * One model call or tool call of an agent attempt (V28), appended by the
 * worker holding the lease before and after the call runs. Only the state
 * moves forward; payload columns hold AES-GCM ciphertext.
 */
@Entity
@Table(name = "agent_steps")
public class AgentStepEntity {
    public enum Kind {
        MODEL_CALL, TOOL_CALL,
        /** The agent delegated to a child process through {@code delegate:<process>} (E20b). */
        DELEGATION
    }

    public enum State {
        STARTED, COMPLETED, FAILED,
        /** A write that may or may not have happened; never re-sent, resolved by an operator. */
        OUTCOME_UNKNOWN,
        /** An approval_required call waiting for a person; the agent's work is parked. */
        PROPOSED,
        /** A person approved the call; it runs next, with exactly the proposed arguments. */
        APPROVED,
        /** A person rejected the call; its result is the rejection, which the agent reads. */
        REJECTED;

        /** A finished step carries its result and lets the next step be journaled. */
        public boolean terminal() {
            return this != STARTED && this != PROPOSED && this != APPROVED;
        }
    }

    @Id
    @Column(length = 36)
    private String id = UUID.randomUUID().toString();
    @Column(name = "external_task_id", nullable = false)
    private String externalTaskId;
    @Column(name = "process_instance_id", nullable = false)
    private String processInstanceId;
    @Column(name = "token_id")
    private String tokenId;
    @Column(name = "activity_id", nullable = false)
    private String activityId;
    @Column(nullable = false)
    private int attempt;
    @Column(name = "sequence_no", nullable = false)
    private int sequence;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Kind kind;
    @Column(name = "tool_ref")
    private String toolRef;
    @Column(name = "policy")
    private String policy;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private State state;
    @Column(name = "idempotency_key")
    private String idempotencyKey;
    @Column(name = "request_digest", nullable = false)
    private String requestDigest;
    @Column(name = "result_digest")
    private String resultDigest;
    @Column(name = "request_enc", columnDefinition = "TEXT")
    private String requestEnc;
    @Column(name = "result_enc", columnDefinition = "TEXT")
    private String resultEnc;
    @Column(name = "error_type")
    private String errorType;
    @Column(name = "model")
    private String model;
    @Column(name = "prompt_version")
    private String promptVersion;
    @Column(name = "prompt_tokens")
    private Integer promptTokens;
    @Column(name = "completion_tokens")
    private Integer completionTokens;
    @Column(name = "worker_id", nullable = false)
    private String workerId;
    @Column(name = "resolved_by")
    private String resolvedBy;

    /** The child instance a DELEGATION step started (V32). */
    @Column(name = "child_instance_id")
    private String childInstanceId;

    public String getChildInstanceId() { return childInstanceId; }
    public void setChildInstanceId(String value) { childInstanceId = value; }

    /** When a person approved or rejected a PROPOSED step (V31). */
    @Column(name = "decided_at")
    private Instant decidedAt;

    public Instant getDecidedAt() { return decidedAt; }
    public void setDecidedAt(Instant value) { decidedAt = value; }
    @Column(name = "started_at", nullable = false)
    private Instant startedAt;
    @Column(name = "finished_at")
    private Instant finishedAt;
    /** Engine-computed cost (V30); null with {@link #costUnpriced} when no price applied. */
    @Column(name = "cost_usd", precision = 18, scale = 8)
    private java.math.BigDecimal costUsd;
    @Column(name = "cost_unpriced", nullable = false)
    private boolean costUnpriced;
    /** Evidence mode applied to the payload columns: none, redacted or full. */
    @Column(name = "payload_mode", nullable = false)
    private String payloadMode = "none";
    /** Policy-shaped evidence copies (V30); the request/result columns are the worker's working copy. */
    @Column(name = "evidence_request_enc", columnDefinition = "TEXT")
    private String evidenceRequestEnc;
    @Column(name = "evidence_result_enc", columnDefinition = "TEXT")
    private String evidenceResultEnc;
    @Column(name = "purge_after")
    private Instant purgeAfter;
    @Column(name = "purged_at")
    private Instant purgedAt;
    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    public java.math.BigDecimal getCostUsd() { return costUsd; }
    public void setCostUsd(java.math.BigDecimal value) { costUsd = value; }
    public boolean isCostUnpriced() { return costUnpriced; }
    public void setCostUnpriced(boolean value) { costUnpriced = value; }
    public String getEvidenceRequestEnc() { return evidenceRequestEnc; }
    public void setEvidenceRequestEnc(String value) { evidenceRequestEnc = value; }
    public String getEvidenceResultEnc() { return evidenceResultEnc; }
    public void setEvidenceResultEnc(String value) { evidenceResultEnc = value; }
    public String getPayloadMode() { return payloadMode; }
    public void setPayloadMode(String value) { payloadMode = value; }
    public Instant getPurgeAfter() { return purgeAfter; }
    public void setPurgeAfter(Instant value) { purgeAfter = value; }
    public Instant getPurgedAt() { return purgedAt; }
    public void setPurgedAt(Instant value) { purgedAt = value; }

    public String getId() { return id; }
    public String getExternalTaskId() { return externalTaskId; }
    public void setExternalTaskId(String value) { externalTaskId = value; }
    public String getProcessInstanceId() { return processInstanceId; }
    public void setProcessInstanceId(String value) { processInstanceId = value; }
    public String getTokenId() { return tokenId; }
    public void setTokenId(String value) { tokenId = value; }
    public String getActivityId() { return activityId; }
    public void setActivityId(String value) { activityId = value; }
    public int getAttempt() { return attempt; }
    public void setAttempt(int value) { attempt = value; }
    public int getSequence() { return sequence; }
    public void setSequence(int value) { sequence = value; }
    public Kind getKind() { return kind; }
    public void setKind(Kind value) { kind = value; }
    public String getToolRef() { return toolRef; }
    public void setToolRef(String value) { toolRef = value; }
    public String getPolicy() { return policy; }
    public void setPolicy(String value) { policy = value; }
    public State getState() { return state; }
    public void setState(State value) { state = value; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public void setIdempotencyKey(String value) { idempotencyKey = value; }
    public String getRequestDigest() { return requestDigest; }
    public void setRequestDigest(String value) { requestDigest = value; }
    public String getResultDigest() { return resultDigest; }
    public void setResultDigest(String value) { resultDigest = value; }
    public String getRequestEnc() { return requestEnc; }
    public void setRequestEnc(String value) { requestEnc = value; }
    public String getResultEnc() { return resultEnc; }
    public void setResultEnc(String value) { resultEnc = value; }
    public String getErrorType() { return errorType; }
    public void setErrorType(String value) { errorType = value; }
    public String getModel() { return model; }
    public void setModel(String value) { model = value; }
    public String getPromptVersion() { return promptVersion; }
    public void setPromptVersion(String value) { promptVersion = value; }
    public Integer getPromptTokens() { return promptTokens; }
    public void setPromptTokens(Integer value) { promptTokens = value; }
    public Integer getCompletionTokens() { return completionTokens; }
    public void setCompletionTokens(Integer value) { completionTokens = value; }
    public String getWorkerId() { return workerId; }
    public void setWorkerId(String value) { workerId = value; }
    public String getResolvedBy() { return resolvedBy; }
    public void setResolvedBy(String value) { resolvedBy = value; }
    public Instant getStartedAt() { return startedAt; }
    public void setStartedAt(Instant value) { startedAt = value; }
    public Instant getFinishedAt() { return finishedAt; }
    public void setFinishedAt(Instant value) { finishedAt = value; }
}
