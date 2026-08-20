package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Per-project (or global when null), per-principal, per-topic liveness and
 * incident record for external workers. Written on every worker fetch
 * (debounced) and on every rejected fetch, so operators can see at a glance
 * whether a worker is reachable, healthy, or failing with a stored error
 * message.
 *
 * This is operational metadata, not workflow state: concurrent replicas may
 * overwrite the same row and last-writer-wins is acceptable.
 */
@Entity
@Table(name = "worker_health")
public class WorkerHealthEntity {
    @Id
    private String id = UUID.randomUUID().toString();
    @Column(name = "project_id")
    private String projectId;
    @Column(name = "principal_id", nullable = false)
    private String principalId;
    @Column(nullable = false)
    private String topic;
    @Column(nullable = false)
    private String status;
    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;
    @Column(name = "last_success_at")
    private Instant lastSuccessAt;
    @Column(name = "last_error_at")
    private Instant lastErrorAt;
    @Column(name = "last_error_message")
    private String lastErrorMessage;
    @Column(name = "consecutive_failures", nullable = false)
    private int consecutiveFailures;
    @Column(name = "last_worker_id")
    private String lastWorkerId;

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String value) { projectId = value; }
    public String getPrincipalId() { return principalId; }
    public void setPrincipalId(String value) { principalId = value; }
    public String getTopic() { return topic; }
    public void setTopic(String value) { topic = value; }
    public String getStatus() { return status; }
    public void setStatus(String value) { status = value; }
    public Instant getLastSeenAt() { return lastSeenAt; }
    public void setLastSeenAt(Instant value) { lastSeenAt = value; }
    public Instant getLastSuccessAt() { return lastSuccessAt; }
    public void setLastSuccessAt(Instant value) { lastSuccessAt = value; }
    public Instant getLastErrorAt() { return lastErrorAt; }
    public void setLastErrorAt(Instant value) { lastErrorAt = value; }
    public String getLastErrorMessage() { return lastErrorMessage; }
    public void setLastErrorMessage(String value) { lastErrorMessage = value; }
    public int getConsecutiveFailures() { return consecutiveFailures; }
    public void setConsecutiveFailures(int value) { consecutiveFailures = value; }
    public String getLastWorkerId() { return lastWorkerId; }
    public void setLastWorkerId(String value) { lastWorkerId = value; }
}