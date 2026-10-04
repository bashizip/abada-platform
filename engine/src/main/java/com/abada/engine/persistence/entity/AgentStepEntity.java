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
    public enum Kind { MODEL_CALL, TOOL_CALL }

    public enum State {
        STARTED, COMPLETED, FAILED,
        /** A write that may or may not have happened; never re-sent, resolved by an operator. */
        OUTCOME_UNKNOWN;

        public boolean terminal() {
            return this != STARTED;
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
    @Column(name = "started_at", nullable = false)
    private Instant startedAt;
    @Column(name = "finished_at")
    private Instant finishedAt;
    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

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
