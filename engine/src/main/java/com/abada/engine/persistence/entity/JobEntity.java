package com.abada.engine.persistence.entity;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "jobs")
public class JobEntity {

    @Id
    private String id;

    private String processInstanceId;

    private String eventId;

    private Instant executionTimestamp;

    @Enumerated(EnumType.STRING)
    private Status status = Status.AVAILABLE;

    private String leaseOwner;
    private Instant leaseExpiresAt;
    private int attempts;
    private int maxAttempts = 3;

    @Column(columnDefinition = "TEXT")
    private String lastError;

    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    /** CANCELLED marks a job that lost a competing-event race: the sibling
     *  wait state fired first and the job must never advance the instance. */
    public enum Status { AVAILABLE, LEASED, COMPLETED, FAILED, CANCELLED }

    public JobEntity() {
        this.id = UUID.randomUUID().toString();
    }

    public JobEntity(String processInstanceId, String eventId, Instant executionTimestamp) {
        this();
        this.processInstanceId = processInstanceId;
        this.eventId = eventId;
        this.executionTimestamp = executionTimestamp;
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

    public String getEventId() {
        return eventId;
    }

    public void setEventId(String eventId) {
        this.eventId = eventId;
    }

    public Instant getExecutionTimestamp() {
        return executionTimestamp;
    }

    public void setExecutionTimestamp(Instant executionTimestamp) {
        this.executionTimestamp = executionTimestamp;
    }

    public Status getStatus() { return status; }
    public void setStatus(Status status) { this.status = status; }
    public String getLeaseOwner() { return leaseOwner; }
    public void setLeaseOwner(String leaseOwner) { this.leaseOwner = leaseOwner; }
    public Instant getLeaseExpiresAt() { return leaseExpiresAt; }
    public void setLeaseExpiresAt(Instant leaseExpiresAt) { this.leaseExpiresAt = leaseExpiresAt; }
    public int getAttempts() { return attempts; }
    public void setAttempts(int attempts) { this.attempts = attempts; }
    public int getMaxAttempts() { return maxAttempts; }
    public void setMaxAttempts(int maxAttempts) { this.maxAttempts = maxAttempts; }
    public String getLastError() { return lastError; }
    public void setLastError(String lastError) { this.lastError = lastError; }
    public long getEntityVersion() { return entityVersion; }
}
