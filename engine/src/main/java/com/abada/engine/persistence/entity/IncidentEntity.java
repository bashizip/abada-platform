package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** A runtime condition an operator must act on (V24). Open while {@code resolvedAt} is null. */
@Entity
@Table(name = "incidents")
public class IncidentEntity {
    public enum Type {
        /** A loop step reached max_iterations and declares no on_exhausted route. */
        LOOP_EXHAUSTED,
        /** A message wait was reached without a correlationKey variable to correlate on. */
        MISSING_CORRELATION_KEY,
        /** Task work failed its last attempt (or a user task was failed) and declares no on_error route. */
        WORK_FAILED,
        /**
         * An agent's write without an idempotency key was interrupted: it may or
         * may not have happened, so it is never re-sent. An operator confirms the
         * outcome when retrying.
         */
        TOOL_OUTCOME_UNKNOWN,
        /**
         * A call-process child failed or was cancelled, or could not start (inputs
         * or depth), and the call declares no on_error route. Retrying starts a new child.
         */
        CHILD_FAILED
    }

    @Id
    @Column(length = 36)
    private String id;

    @Column(name = "project_id", nullable = false, length = 36)
    private String projectId;

    @Column(name = "process_instance_id", nullable = false)
    private String processInstanceId;

    @Column(name = "token_id", length = 36)
    private String tokenId;

    @Column(name = "activity_id", nullable = false)
    private String activityId;

    @Column(name = "incident_type", nullable = false, length = 64)
    private String type;

    @Column(nullable = false, length = 1024)
    private String message;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    @Column(length = 64)
    private String resolution;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getProcessInstanceId() { return processInstanceId; }
    public void setProcessInstanceId(String processInstanceId) { this.processInstanceId = processInstanceId; }
    public String getTokenId() { return tokenId; }
    public void setTokenId(String tokenId) { this.tokenId = tokenId; }
    public String getActivityId() { return activityId; }
    public void setActivityId(String activityId) { this.activityId = activityId; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getResolvedAt() { return resolvedAt; }
    public void setResolvedAt(Instant resolvedAt) { this.resolvedAt = resolvedAt; }
    public String getResolution() { return resolution; }
    public void setResolution(String resolution) { this.resolution = resolution; }
}
