package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * One thread of execution in a process instance (V23). Rows are written only
 * inside the instance's locked command, so they carry no version column; they
 * are deleted with their instance.
 */
@Entity
@Table(name = "process_tokens")
public class ProcessTokenEntity {
    @Id
    @Column(length = 36)
    private String id;

    @Column(name = "process_instance_id", nullable = false)
    private String processInstanceId;

    @Column(name = "activity_id", nullable = false)
    private String activityId;

    @Column(nullable = false, length = 32)
    private String state;

    @Column(name = "parent_token_id", length = 36)
    private String parentTokenId;

    @Column(name = "scope_token_id", length = 36)
    private String scopeTokenId;

    @Column(name = "loop_counter", nullable = false)
    private int loopCounter;

    /** JSON map of loop step id to the token's current pass (V25); null before V25. */
    @Column(name = "loop_counts", columnDefinition = "TEXT")
    private String loopCounts;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getProcessInstanceId() { return processInstanceId; }
    public void setProcessInstanceId(String processInstanceId) { this.processInstanceId = processInstanceId; }
    public String getActivityId() { return activityId; }
    public void setActivityId(String activityId) { this.activityId = activityId; }
    public String getState() { return state; }
    public void setState(String state) { this.state = state; }
    public String getParentTokenId() { return parentTokenId; }
    public void setParentTokenId(String parentTokenId) { this.parentTokenId = parentTokenId; }
    public String getScopeTokenId() { return scopeTokenId; }
    public void setScopeTokenId(String scopeTokenId) { this.scopeTokenId = scopeTokenId; }
    public int getLoopCounter() { return loopCounter; }
    public void setLoopCounter(int loopCounter) { this.loopCounter = loopCounter; }
    public String getLoopCounts() { return loopCounts; }
    public void setLoopCounts(String loopCounts) { this.loopCounts = loopCounts; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
