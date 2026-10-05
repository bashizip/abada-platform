package com.abada.engine.persistence.entity;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "external_tasks")
public class ExternalTaskEntity {

    @Id
    private String id;

    private String processInstanceId;

    /** Token this work resumes; null for rows created before V23. */
    @Column(name = "token_id", length = 36)
    private String tokenId;

    private String topicName;

    @Enumerated(EnumType.STRING)
    private Status status;

    private String workerId; // The ID of the worker that has locked the task

    private Instant lockExpirationTime;

    // Error tracking for incident management
    @Column(name = "exception_message", columnDefinition = "TEXT")
    private String exceptionMessage;

    @Column(name = "exception_stacktrace", columnDefinition = "TEXT")
    private String exceptionStacktrace;

    @Column(name = "retries")
    private Integer retries = 3; // Default retry count

    @Column(name = "activity_id")
    private String activityId; // BPMN element ID for visualization

    @Column(name = "bpmn_error_code")
    private String bpmnErrorCode;

    @Column(name = "bpmn_error_message", columnDefinition = "TEXT")
    private String bpmnErrorMessage;

    @Column(name = "trace_parent", length = 128)
    private String traceParent;

    /** Optional agent attempt metadata reported by an {@code abada:agent} worker (JSON). */
    @Column(name = "agent_metadata", columnDefinition = "TEXT")
    private String agentMetadataJson;

    /** Engine-side output-contract outcome of the last reported agent attempt. */
    @Column(name = "agent_outcome", length = 32)
    private String agentOutcome;

    /** Required model for agent tasks, matched against worker capabilities. */
    @Column(name = "required_model")
    private String requiredModel;

    @Column(name = "created_at")
    private Instant createdAt;

    /** Model chosen by an operator for this task only (V26); replaces the definition's model at fetch. */
    @Column(name = "model_override")
    private String modelOverride;

    /** Rate-limit waits that did not consume an attempt (V26). */
    @Column(name = "deferrals", nullable = false)
    private int deferrals;

    /**
     * The attempt this task is on (V28): a counted failure or an operator retry
     * starts the next one; a lost lease or a deferral resumes the same one.
     */
    @Column(name = "attempt", nullable = false)
    private int attempt = 1;

    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    /** Cost of the tokens this attempt reported in its metadata (V30); see {@link #attemptCostUnpriced}. */
    @Column(name = "attempt_cost_usd", precision = 18, scale = 8)
    private java.math.BigDecimal attemptCostUsd;
    @Column(name = "attempt_cost_unpriced", nullable = false)
    private boolean attemptCostUnpriced;
    @Column(name = "attempt_prompt_tokens", nullable = false)
    private long attemptPromptTokens;
    @Column(name = "attempt_completion_tokens", nullable = false)
    private long attemptCompletionTokens;

    public long getAttemptPromptTokens() { return attemptPromptTokens; }
    public long getAttemptCompletionTokens() { return attemptCompletionTokens; }
    public void addAttemptTokens(Integer prompt, Integer completion) {
        attemptPromptTokens += prompt == null ? 0 : prompt;
        attemptCompletionTokens += completion == null ? 0 : completion;
    }

    public java.math.BigDecimal getAttemptCostUsd() { return attemptCostUsd; }
    public void setAttemptCostUsd(java.math.BigDecimal value) { this.attemptCostUsd = value; }
    public boolean isAttemptCostUnpriced() { return attemptCostUnpriced; }
    public void setAttemptCostUnpriced(boolean value) { this.attemptCostUnpriced = value; }

    public int getAttempt() { return attempt; }
    public void setAttempt(int value) { this.attempt = value; }

    public enum Status {
        OPEN,
        LOCKED,
        COMPLETED,
        FAILED,
        BPMN_ERROR,
        /** Retired without a result: an on_timeout boundary fired or the instance ended. */
        CANCELLED
    }

    public ExternalTaskEntity() {
        this.id = UUID.randomUUID().toString();
        this.status = Status.OPEN;
    }

    public ExternalTaskEntity(String processInstanceId, String topicName) {
        this();
        this.processInstanceId = processInstanceId;
        this.topicName = topicName;
    }

    // Getters and Setters

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getProcessInstanceId() {
        return processInstanceId;
    }

    public void setProcessInstanceId(String processInstanceId) {
        this.processInstanceId = processInstanceId;
    }

    public String getTopicName() {
        return topicName;
    }

    public void setTopicName(String topicName) {
        this.topicName = topicName;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
    }

    public String getWorkerId() {
        return workerId;
    }

    public void setWorkerId(String workerId) {
        this.workerId = workerId;
    }

    public Instant getLockExpirationTime() {
        return lockExpirationTime;
    }

    public void setLockExpirationTime(Instant lockExpirationTime) {
        this.lockExpirationTime = lockExpirationTime;
    }

    public String getExceptionMessage() {
        return exceptionMessage;
    }

    public void setExceptionMessage(String exceptionMessage) {
        this.exceptionMessage = exceptionMessage;
    }

    public String getExceptionStacktrace() {
        return exceptionStacktrace;
    }

    public void setExceptionStacktrace(String exceptionStacktrace) {
        this.exceptionStacktrace = exceptionStacktrace;
    }

    public Integer getRetries() {
        return retries;
    }

    public void setRetries(Integer retries) {
        this.retries = retries;
    }

    public String getActivityId() {
        return activityId;
    }

    public void setActivityId(String activityId) {
        this.activityId = activityId;
    }

    public String getBpmnErrorCode() { return bpmnErrorCode; }
    public void setBpmnErrorCode(String value) { bpmnErrorCode = value; }
    public String getBpmnErrorMessage() { return bpmnErrorMessage; }
    public void setBpmnErrorMessage(String value) { bpmnErrorMessage = value; }
    public String getTraceParent() { return traceParent; }
    public void setTraceParent(String value) { traceParent = value; }

    public String getAgentOutcome() { return agentOutcome; }
    public void setAgentOutcome(String value) { agentOutcome = value; }
    public String getAgentMetadataJson() { return agentMetadataJson; }
    public void setAgentMetadataJson(String value) { agentMetadataJson = value; }

    public String getRequiredModel() { return requiredModel; }
    public void setRequiredModel(String value) { requiredModel = value; }
    public String getModelOverride() { return modelOverride; }
    public void setModelOverride(String value) { modelOverride = value; }
    public int getDeferrals() { return deferrals; }
    public void setDeferrals(int value) { deferrals = value; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }

    public long getEntityVersion() { return entityVersion; }

    public String getTokenId() { return tokenId; }
    public void setTokenId(String tokenId) { this.tokenId = tokenId; }
}
