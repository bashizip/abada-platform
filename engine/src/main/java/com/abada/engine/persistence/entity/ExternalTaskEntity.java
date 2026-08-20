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

    /** Required model for agent tasks, matched against worker capabilities. */
    @Column(name = "required_model")
    private String requiredModel;

    @Column(name = "created_at")
    private Instant createdAt;

    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    public enum Status {
        OPEN,
        LOCKED,
        COMPLETED,
        FAILED,
        BPMN_ERROR
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

    public String getAgentMetadataJson() { return agentMetadataJson; }
    public void setAgentMetadataJson(String value) { agentMetadataJson = value; }

    public String getRequiredModel() { return requiredModel; }
    public void setRequiredModel(String value) { requiredModel = value; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }

    public long getEntityVersion() { return entityVersion; }
}
